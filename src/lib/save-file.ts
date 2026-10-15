/**
 * Hands a produced file to the user. In a browser that is the usual `<a download>` click; inside
 * the desktop app (Tauri) a webview does not download, so the bytes go to the native "Save as"
 * dialog instead (`save_file` in `src-tauri/src/lib.rs`). Nothing leaves the machine either way.
 */

/** True inside the Tauri desktop shell, where `window.__TAURI_INTERNALS__` is injected. */
export function isDesktop(): boolean {
	return typeof window === 'object' && '__TAURI_INTERNALS__' in window;
}

export async function saveFile(name: string, bytes: Uint8Array, type: string): Promise<void> {
	if (isDesktop()) {
		// Loaded on demand so the web build never carries the desktop bridge.
		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('save_file', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } });
		return;
	}
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

/** External links: a new tab in the browser, the system browser from the desktop app. */
export async function openExternal(event: MouseEvent, url: string): Promise<void> {
	if (!isDesktop()) return;
	event.preventDefault();
	const { invoke } = await import('@tauri-apps/api/core');
	await invoke('plugin:opener|open_url', { url });
}
