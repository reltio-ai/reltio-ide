import type { AttrFamily } from './types';

const NAME_RE = /(first|last|middle|full)?name$|^(name|suffix|prefix|legalname)$/i;
/** A login handle ends in "name" but is not a person's or company's name. */
const USERNAME_RE = /user_?name$/i;
const DEMO_RE = /^(dob|dateofbirth|birthdate|gender|sex|age)$/i;
const PHONE_RE = /phone|telephone|mobile|fax|formattednumber/i;
const EMAIL_RE = /email/i;
const ADDRESS_RE = /address|addrline|addressline|zip|postal|city|stateprovince|state$|country|verificationstatus/i;
const ID_RE = /ssn|npi|duns|taxid|identifier|^id$|sfdc|salesforce|nationalid|passport|license/i;
const SSN_RE = /ssn|socialsecurity/i;

function lastSegment(uriOrName: string): string {
	const parts = uriOrName.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? uriOrName;
}

export function classifyAttrFamily(uri: string, name?: string, label?: string): AttrFamily {
	const tokens = [lastSegment(uri), name ?? '', label ?? ''].join(' ');
	if (SSN_RE.test(tokens) || ID_RE.test(lastSegment(uri)) || ID_RE.test(name ?? '')) return 'identifiers';
	if (EMAIL_RE.test(tokens)) return 'email';
	if (PHONE_RE.test(tokens)) return 'phone';
	if (ADDRESS_RE.test(tokens)) return 'address';
	if (DEMO_RE.test(lastSegment(uri)) || DEMO_RE.test(name ?? '')) return 'demographics';
	if (USERNAME_RE.test(lastSegment(uri)) || USERNAME_RE.test(name ?? '')) return 'other';
	if (NAME_RE.test(lastSegment(uri)) || NAME_RE.test(name ?? '')) return 'name';
	return 'other';
}

export function isSsnAttribute(uri: string, name?: string, label?: string): boolean {
	const tokens = [uri, name ?? '', label ?? ''].join(' ');
	return SSN_RE.test(tokens);
}
