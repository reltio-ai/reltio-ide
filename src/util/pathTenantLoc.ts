/** Parse environment + tenant from an L3 file path (no VS Code URI). */
export function pathTenantLocFromL3Path(
	fsPath: string,
): { environmentName: string; tenantId: string } | undefined {
	const parts = fsPath.split(/[/\\]/).filter(Boolean);
	const ti = parts.findIndex(p => p.endsWith('.reltio.tenant'));
	if (ti < 1) return undefined;
	const tenantSeg = parts[ti];
	const envSeg = parts[ti - 1];
	if (!tenantSeg?.endsWith('.reltio.tenant') || !envSeg?.endsWith('.reltio.environment')) {
		return undefined;
	}
	return {
		tenantId: tenantSeg.slice(0, -'.reltio.tenant'.length),
		environmentName: envSeg.slice(0, -'.reltio.environment'.length),
	};
}
