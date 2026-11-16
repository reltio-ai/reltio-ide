/** Default mask: SSN last-4 only. */
export function maskSsn(value: string): string {
	const digits = value.replace(/\D/g, '');
	if (digits.length < 4) return '••••';
	return `••••${digits.slice(-4)}`;
}

export function maybeMaskSsn(value: string, mask: boolean): string {
	if (!mask) return value;
	return maskSsn(value);
}
