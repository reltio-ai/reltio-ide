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

/**
 * Reltio logo (`resources/icons/reltio-icon.png`) inlined as a data URI.
 *
 * The callback server calls `server.close()` immediately after writing its single
 * response, so it can never serve a follow-up request for an image file. Anything
 * the success page renders must therefore travel inside that one HTML payload.
 */
const RELTIO_LOGO_DATA_URI =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAJv0lEQVR42u2dSXAVVRSGj5sXXejO0oUbLXWhGyWWlK5duLCssiw3btxY5UYtyyoHVJxwxBkcEFREnGfROKECohCUhCEmEMgEATIAgZARQjhWJ33zTi7d/W7P5/Y7i7NMVae/793+333nngaAWihwXQhQizHrYhv/d0Q0qiLBnkgAtmmdFAHyr7EMgVeqCREgm0JLSgRIsNZYBF6vJhGg+J92lquCzQJgwUsEqFLwmYpgkwBY5VW1Atws8GdqcbUJINBTXg24CrBQIFestUUVQOBmuBpwE0CAZiwBFwGuE4ix6wlbBRB4Oa4GeQsgwHKWIE8BBBQDCfISQAAxkSAPAQQMIwmyFkCAMJMgSwEEBEMJshJAADCVIAsB5sqNZ1PPRecon/4q3zYW+FUuAWf4ze38asFShDOuKpAE4f7g3kz/GdMkw6H4CFCfpgAoAnjUKUQ4eQrhxCQCzLFsFeD83LcB/uSpMvzxkwhjJxFGJiySgPNXPtvgj7rwh04gDJ5AGJvMU4D3khQARQAP+BOnEI4T+MMTCMdc+EeOIxweRzg0znwV4PyVj+vzfgr+5DR8Z8kfnSjDP0rgHxxH6B9D6B1lLIEIED7sUfgjFP5xhAEFfwyhz4V/YBRh34iVAqAI4JH0xwn8IQ3+IQK/x4E/Mg1/7zBC1xBDCUQAA/g+Sd+BP6jB7yfw92vwO4YQusesEQBFABL2/JK+87wfGC/D7yXwuzX4bccQdg8yWwVEgGSSfj953k/BH0bYo8HfNYjQOoiw4yh7AbCqBaiU9Ad9kr4Kewp+pwP/WBn+Thd+8xFGq4AI4B/2TJN+D4G/l8Bvd5Z8Bf8oQosLv2kAYdsAWwGWWC3AWXOzu76gsKfgtxL4/xH4Ww7ncU87TARAESCMBOOnh712N+yp572Cv30AYasLv+EQQn0fg1VABIhf+8b8w56z5M/AP4zQ6ML/9yDCpoPsBEARIGL5hb0mDf5mAn9jP4MwKAIkVHP8wx6F/w+B/3efCFAcAWr9w17joTL8egJ/fV9eDSSeAnSKADGLhr1tJOz9q+D3I2xQ8HsR1vXm2V94mgAoAsQsGvYo/E0E/l8E/poehGvuEAEKI4Bf0t9I4P/Zi7DWhf/7AYQLbhQBCiNAUNibgd+D8IcLf/X+PJtIZwkwLAIkUEFhj8L/zYX/y/487+8kFQBFgJjVQOHTsNc3/byn8H914f+0j0HnsAiQDHw96eth748DZfg/u/DrukUA6wWgSV8Pe+tI2JuBvw/hRxd+nawAyQmgfsPPSgCvbd0NWthT8FcfmF7yFfwfuhG+38vk8AjUnmO9ALRb98yUBXB+zfNL+ut9kr563iv4q/YifMtCgCsdAfqtFkBv4EhLAJNtXb+kPwW/m8DfgwCXMbnPnM+7h+rWdbt3khagSdvW3RywrbvGJ+k7z/vvCfyv9zC6z7YK4HcuLykBvBo4KiV9PexR+N9xhG+rAH7duk6rdlwBKjVw1Ack/dVa0ldhz4H/jQt/3lciQGQBPLt1tVbtOAKYNHD8HSLpryLwv+pC+LKL4X22RQCTc3lOq3ZUAZr13/ANk35g2CPwv+hiep9tEMCvVXvIo1U7igBhGjjWBcCv05L+1wp+J+OZQtwFqDSEQT+XF1aAsA0cQdu6ethzlvzbFjGfLMb54rzO5Q1XOJcXRoDmox5hr0IDh9+2rh72vuxiDt4GAaKcywsjQFDYm7WtGyLpsw17NgoQZgKHOpp15tXmO3tRGjgqJX3rhktyvriwEzic0zmmAsTZ1q3zSPrWThflfHF+QxiCJnCYCHDD/ZXD3lqDbd1vuiwGb4MAfkm/L2AIg4kAcRo4HPjnXV+g+cKcL84v7FH4+hAGEwFMGjj8wl7hBkxDbS/bi4syhKHGQICKYY9tA0cqApzN9uIUfK+wR4cwtJEhDDUGXwOjNHAUc7z8FbxbwnzDXsAEDhMBTLp19W3dwr5fgLMAFSdweAxhMBHANOyt4vobfrUIUGnc2gx88hu+iQCm27rf2ratWzQBTMat6b/hmwgQdlv3806ETzsLLcAxlhdoMm5Nb+AwESBMA8cU/A6EjzsQPimUBJP8D4eajlujDRwmAvx50KyBg8L/sB1hZRvCirYCffq5C9BpOG6NduvWGP4a6Bf2VAPHZxr8D1z4y3cjvLsL4axrRYDUK2jcml8Dh6kAfg0cCv4nHQgftZfhv7+7DH/ZLoS3WxGW7ES48JbCCNDG7iJ3m4xb0xo4TAW4a/npDRyfa/BXEvjvKfit0/Df2onw5g6E13cgLGpBeLWFywujIgvAbxVoDTFuTTVw1IRoCPEKexT+CgL/nV0ISwn8Nyj8ZoSXmxFe+g/hhSaE55sQ5m+wAD53ASh80waOMALAlcFhb7kGfwmBv1iD/yKB/+x2hKe3ITy1DeHJrQiPb0V4bAvCo1sQzr+Jw0phiQBhunXVnn5NyKbQSmFvBr6z5Cv4LQivtSC8QuAv1OAvUPBd8PMbER5uQJjXgPDA5tnFSABeEoTu1u1BKEVoC/+Yhr222WGPwn9dg+8s+Qr+c9tnw3+CwH8kAH72Alg0KzjKubxSxIMhfmGPwl+kwX+BwH9Gwd86DX9qyW+chv9QA8KDPvAZCvAyGwE8x631BTdwlGIcDVPP+2UBYY/Cf57AV897BX8+hb/ZH362ArTa9cKISufyvBo4SjEPh+pJf3FA0neW/Gc8wt7U894QfrYCWPbGkCjn8koJHA+/7tEy/Ne0pL/QL+kbhD2LBOAhgfO839gfroGjlOCAiJmkT8NeQNJ/JAL87ASw8K1hYc/lOXv6pRRGxLwYEPYo/IciwGcsQP4SmHTr6g0cpRSHRKmwtyBi2MtPAEvfHBrlXF7p6vSv6/710cKehQLkK4FJt+532m/4WQhA6776ePDTF8Dit4ebnstT8J1t3awF0GteY+EEyE8Ck3FregNH3gJ41UW3IszbkocAkJQAlxa0K7bI9XSSAoDcUFs7fpITQCQoHPzwAtwmN5d91aUpgKwChfr0RxNAJCgM/OgCiASFgB9PgEvkprOpe/IQQFYB6z/98QUQCayGn4wAIoG18JMTQCSwEn6yAogE1sFPXgCRwCr46QggElgDPz0BRAIr4KcrgFOXC7jYdXuqjKK8nzlMyWqQz6femE9GAogEGS/5HAVw6m4BW7FWJrG0cxVAVoOMgh53AZyaK8Bn6s6kw50NAshqkOLXO5sEqFYRUv0KbqMA1SICZFE2C1BUESDLKoIAqlZaDH111uCLKICNqwLkXUUVgFYfI+BHOECvNgH0Gs0Q+AluwEUA7zoXoHYkBuhxgNrzucOOI8D/Dm/k+u/fneQAAAAASUVORK5CYII=';

/**
 * Success page shown in the browser once the OAuth callback carries a valid code:
 * the Reltio logo with the confirmation message to its right (RP-190109).
 *
 * Exported for unit testing — production callers go through `startCallbackServer`.
 */
export function buildCallbackSuccessHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Reltio login complete</title>
  <style>
    body { box-sizing: border-box; font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; line-height: 1.5; }
    .panel { display: flex; align-items: center; gap: 1.25rem; }
    .panel img { width: 64px; height: 64px; flex: none; }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    p { margin: 0; }
  </style>
</head>
<body>
  <div class="panel">
    <img src="${RELTIO_LOGO_DATA_URI}" alt="Reltio" />
    <div>
      <h1>Login Successful!</h1>
      <p>You are signed into Reltio IDE. You can now close this browser tab.</p>
    </div>
  </div>
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
