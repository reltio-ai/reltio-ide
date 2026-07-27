import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import type { OAuthClientCredentials } from './oauthCredentialsStore';
import type { OAuthSession } from './tokenStore';

const REDIRECT_PORT = 8081;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const AUTH_HOST = 'auth.reltio.com';
const SSO_ENDPOINT = `https://${AUTH_HOST}/oauth/sso`;
const SSO_CHECK_ENDPOINT = `https://${AUTH_HOST}/oauth/ssoCheck`;
const TOKEN_ENDPOINT = `https://${AUTH_HOST}/oauth/token`;
const LOGIN_TIMEOUT_MS = 120_000;

/** Deep link to focus the extension host (best-effort from the callback page). */
const VSCODE_FOCUS_URI = 'vscode://reltio-community.reltio-metadata-editor';
const CURSOR_FOCUS_URI = 'cursor://';

export type OAuthLoginErrorCode =
	| 'PORT_BUSY'
	| 'TIMEOUT'
	| 'EXCHANGE_FAILED'
	| 'REFRESH_FAILED'
	| 'NO_IDP_CONFIGURED'
	| 'STATE_MISMATCH'
	| 'SSO_CHECK_FAILED';

export class OAuthLoginError extends Error {
	constructor(message: string, readonly code: OAuthLoginErrorCode) {
		super(message);
		this.name = 'OAuthLoginError';
	}
}

function buildCallbackSuccessHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Reltio login complete</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    .actions { margin-top: 1.5rem; }
    a { display: inline-block; margin-right: 0.75rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Login successful</h1>
  <p>You are signed in to <strong>Reltio Metadata Editor</strong>. You can close this browser tab and continue in VS Code or Cursor.</p>
  <p class="actions">
    <a href="${VSCODE_FOCUS_URI}">Open in VS Code</a>
    <a href="${CURSOR_FOCUS_URI}">Open in Cursor</a>
  </p>
  <p><small>If the links do not switch apps, check the notification in your editor — your session is already active.</small></p>
</body>
</html>`;
}

function buildCallbackErrorHtml(message: string): string {
	const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Login failed</title></head>
<body><h1>Login failed</h1><p>${escaped}</p><p>Return to the editor and try again.</p></body>
</html>`;
}

function startCallbackServer(
	expectedState: string,
): Promise<{ server: http.Server; codePromise: Promise<string> }> {
	return new Promise((resolve, reject) => {
		let resolveCode!: (code: string) => void;
		let rejectCode!: (err: Error) => void;
		const codePromise = new Promise<string>((res, rej) => {
			resolveCode = res;
			rejectCode = rej;
		});

		const server = http.createServer((req, res) => {
			try {
				const urlObj = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);
				const code = urlObj.searchParams.get('code');
				const returnedState = urlObj.searchParams.get('state');
				if (!code) {
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(buildCallbackErrorHtml('No authorization code in callback URL.'));
					rejectCode(new Error('No authorization code in callback'));
				} else if (returnedState !== expectedState) {
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(buildCallbackErrorHtml('State mismatch — possible CSRF. Restart login.'));
					rejectCode(
						new OAuthLoginError(
							'Login state did not match. Possible CSRF — restart login.',
							'STATE_MISMATCH',
						),
					);
				} else {
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(buildCallbackSuccessHtml());
					resolveCode(code);
				}
			} catch (e) {
				res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(buildCallbackErrorHtml('Unexpected error processing callback.'));
				rejectCode(e as Error);
			}
			server.close();
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				reject(
					new OAuthLoginError(
						`OAuth callback port ${REDIRECT_PORT} is unavailable. Close the application using that port and try again.`,
						'PORT_BUSY',
					),
				);
			} else {
				reject(err);
			}
		});

		server.listen(REDIRECT_PORT, 'localhost', () => {
			resolve({ server, codePromise });
		});
	});
}

async function exchangeCodeForTokens(
	code: string,
	credentials: OAuthClientCredentials,
): Promise<OAuthSession> {
	const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: REDIRECT_URI,
	});

	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
	});

	if (!res.ok) {
		throw new OAuthLoginError(`Token exchange failed: HTTP ${res.status}`, 'EXCHANGE_FAILED');
	}

	const data = (await res.json()) as Record<string, unknown>;
	const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
	return {
		accessToken: data.access_token as string,
		refreshToken: data.refresh_token as string,
		expiresAt: Date.now() + expiresIn * 1000,
	};
}

export async function refreshTokens(
	existingRefreshToken: string,
	credentials: OAuthClientCredentials,
): Promise<OAuthSession> {
	const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: existingRefreshToken,
	});

	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
	});

	if (!res.ok) {
		throw new OAuthLoginError(`Token refresh failed: HTTP ${res.status}`, 'REFRESH_FAILED');
	}

	const data = (await res.json()) as Record<string, unknown>;
	const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
	return {
		accessToken: data.access_token as string,
		refreshToken: (data.refresh_token as string | undefined) ?? existingRefreshToken,
		expiresAt: Date.now() + expiresIn * 1000,
	};
}

/**
 * Asks Reltio Auth whether the given tenant routes login through an external IdP.
 * Returns `'sso'` when external SSO is configured, `'native'` when Reltio-native
 * authentication is the only option. Throws `SSO_CHECK_FAILED` on transport or
 * server errors.
 */
export type SsoStatus = 'sso' | 'native';

export async function ssoCheck(
	ssoTenantId: string,
	credentials: OAuthClientCredentials,
	state: string,
): Promise<SsoStatus> {
	const body = new URLSearchParams({
		tenant_id: ssoTenantId,
		client_id: credentials.clientId,
		response_type: 'code',
		state,
		redirect_uri: REDIRECT_URI,
	});

	let res: Response;
	try {
		res = await fetch(SSO_CHECK_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
	} catch (e) {
		throw new OAuthLoginError(
			`Could not reach ${SSO_CHECK_ENDPOINT}: ${(e as Error).message}`,
			'SSO_CHECK_FAILED',
		);
	}

	if (!res.ok) {
		throw new OAuthLoginError(`SSO check failed: HTTP ${res.status}`, 'SSO_CHECK_FAILED');
	}

	const data = (await res.json()) as Record<string, unknown>;
	if (data.status === 'sso') return 'sso';
	if (data.status === 'native') return 'native';
	const reason = typeof data.error === 'string' ? data.error : JSON.stringify(data);
	throw new OAuthLoginError(`SSO check returned unexpected response: ${reason}`, 'SSO_CHECK_FAILED');
}

export function buildAuthorizationUrl(
	credentials: OAuthClientCredentials,
	ssoTenantId: string,
	state: string,
): string {
	const params = new URLSearchParams({
		tenant_id: ssoTenantId,
		response_type: 'code',
		client_id: credentials.clientId,
		redirect_uri: REDIRECT_URI,
		state,
	});
	return `${SSO_ENDPOINT}?${params.toString()}`;
}

export async function runBrowserLogin(
	credentials: OAuthClientCredentials,
	ssoTenantId: string,
): Promise<OAuthSession> {
	const state = crypto.randomBytes(16).toString('hex');

	const status = await ssoCheck(ssoTenantId, credentials, state);
	if (status === 'native') {
		throw new OAuthLoginError(
			`Tenant "${ssoTenantId}" has no external identity provider configured. Browser login is unavailable for this tenant.`,
			'NO_IDP_CONFIGURED',
		);
	}

	const { server, codePromise } = await startCallbackServer(state);

	const authUrl = buildAuthorizationUrl(credentials, ssoTenantId, state);
	await vscode.env.openExternal(vscode.Uri.parse(authUrl));

	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => {
			server.close();
			reject(new OAuthLoginError('Login timed out. Please try again.', 'TIMEOUT'));
		}, LOGIN_TIMEOUT_MS),
	);

	const code = await Promise.race([codePromise, timeout]);
	return exchangeCodeForTokens(code, credentials);
}
