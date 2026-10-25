/**
 * One debounce timer per key, instead of one shared timer.
 *
 * A single shared `setTimeout` handle drops the first caller's work whenever a second key
 * schedules inside the window — two documents changing together (a refactor, a git
 * checkout) left the first with stale diagnostics. Keying by document URI keeps each
 * independent, and `cancel()` lets a closed document drop its pending update.
 */
export class KeyedDebouncer {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(private readonly delayMs: number) {}

	schedule(key: string, work: () => void): void {
		const pending = this.timers.get(key);
		if (pending) clearTimeout(pending);
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				work();
			}, this.delayMs),
		);
	}

	cancel(key: string): void {
		const pending = this.timers.get(key);
		if (!pending) return;
		clearTimeout(pending);
		this.timers.delete(key);
	}

	dispose(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}
}
