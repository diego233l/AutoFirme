<script lang="ts">
	/**
	 * Placement editor for a visible signature: renders a page of the PDF with pdf.js and lets the
	 * user drag and resize the signature image over it. The result is a page number and a rectangle
	 * in PDF user space (`[x1, y1, x2, y2]`, origin bottom-left) — what `signPdf`'s `visible.rect`
	 * and `stampPdf` take. pdf.js is only loaded when the editor opens.
	 */
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { Copy } from '#lib/i18n';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
	import { tick } from 'svelte';

	type Rect = [number, number, number, number];

	interface Props {
		copy: Copy;
		open: boolean;
		/** The PDF the preview is drawn from. */
		file: File | null;
		/** Signature image (PNG/JPEG); a dashed placeholder stands in while there is none. */
		image: Uint8Array | null;
		/** One-based page and PDF rectangle already chosen, to reopen the editor where it was left. */
		page: number;
		rect: Rect | null;
		onapply: (page: number, rect: Rect) => void;
	}

	let { copy, open = $bindable(), file, image, page, rect, onapply }: Props = $props();

	/** Widest the preview gets, in CSS pixels; narrower dialogs shrink it. */
	const MAX_WIDTH = 720;

	let pdf = $state<PDFDocumentProxy | null>(null);
	let pageCount = $state(0);
	let current = $state(1);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let canvas = $state<HTMLCanvasElement | null>(null);
	let stage = $state<HTMLDivElement | null>(null);
	let viewport = $state<PageViewport | null>(null);
	/** The box in CSS pixels, relative to the rendered page. */
	let box = $state({ x: 0, y: 0, width: 0, height: 0 });
	/** Width / height of the signature image, 3:1 until it is known. */
	let aspect = $state(3);
	let imageUrl = $state<string | null>(null);

	$effect(() => {
		if (!image) {
			imageUrl = null;
			aspect = 3;
			return;
		}
		const url = URL.createObjectURL(new Blob([image as Uint8Array<ArrayBuffer>]));
		imageUrl = url;
		const probe = new Image();
		probe.onload = () => {
			if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
				aspect = probe.naturalWidth / probe.naturalHeight;
			}
		};
		probe.src = url;
		return () => URL.revokeObjectURL(url);
	});

	// Open → load the document once per opening; close → drop it.
	$effect(() => {
		if (!open || !file) return;
		let cancelled = false;
		let loaded: PDFDocumentProxy | null = null;
		status = 'loading';
		current = Math.max(1, page);
		void (async () => {
			try {
				// The legacy build runs on older webviews too (WKWebView on macOS 11, older WebView2).
				const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
				const { default: workerSrc } = await import(
					'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
				);
				pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
				// pdf.js takes ownership of the buffer it is given, so it gets a copy.
				const data = new Uint8Array(await file.arrayBuffer());
				loaded = await pdfjs.getDocument({ data }).promise;
				if (cancelled) return void loaded.destroy();
				pdf = loaded;
				pageCount = loaded.numPages;
				current = Math.min(current, pageCount);
				await renderPage(true);
			} catch (reason) {
				console.error('[autofirme:placer] opening the PDF failed', reason);
				if (!cancelled) status = 'error';
			}
		})();
		return () => {
			cancelled = true;
			void loaded?.destroy();
			pdf = null;
			viewport = null;
		};
	});

	async function renderPage(restore: boolean) {
		// The dialog mounts its content after `open` flips, so the canvas can lag a frame behind.
		for (let attempt = 0; !canvas && attempt < 10; attempt += 1) {
			await tick();
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		if (!pdf || !canvas) return;
		status = 'loading';
		const proxy = await pdf.getPage(current);
		const base = proxy.getViewport({ scale: 1 });
		// The whole page fits on screen: the box can be dropped anywhere without scrolling, and the
		// dialog's buttons stay in view.
		const width = Math.min(MAX_WIDTH, (stage?.parentElement?.clientWidth || MAX_WIDTH) - 24);
		const height = Math.max(240, globalThis.innerHeight - 280);
		const next = proxy.getViewport({
			scale: Math.min(width / base.width, height / base.height)
		});
		const ratio = globalThis.devicePixelRatio || 1;
		canvas.width = Math.floor(next.width * ratio);
		canvas.height = Math.floor(next.height * ratio);
		canvas.style.width = `${next.width}px`;
		canvas.style.height = `${next.height}px`;
		await proxy.render({
			canvasContext: canvas.getContext('2d')!,
			viewport: next,
			transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
		}).promise;
		viewport = next;
		placeInitialBox(restore);
		status = 'ready';
	}

	/** Reopen on the saved rectangle; otherwise the bottom-right corner, 24 pt from the edges. */
	function placeInitialBox(restore: boolean) {
		if (!viewport) return;
		if (restore && rect && page === current) {
			const [ax, ay] = viewport.convertToViewportPoint(rect[0], rect[1]);
			const [bx, by] = viewport.convertToViewportPoint(rect[2], rect[3]);
			box = {
				x: Math.min(ax, bx),
				y: Math.min(ay, by),
				width: Math.abs(bx - ax),
				height: Math.abs(by - ay)
			};
			return;
		}
		const margin = 24 * viewport.scale;
		const width = viewport.width * 0.3;
		const height = width / aspect;
		box = clamp({
			x: viewport.width - width - margin,
			y: viewport.height - height - margin,
			width,
			height
		});
	}

	function clamp(next: typeof box): typeof box {
		if (!viewport) return next;
		const width = Math.min(Math.max(next.width, 24), viewport.width);
		const height = Math.min(Math.max(next.height, 12), viewport.height);
		return {
			width,
			height,
			x: Math.min(Math.max(next.x, 0), viewport.width - width),
			y: Math.min(Math.max(next.y, 0), viewport.height - height)
		};
	}

	async function go(delta: number) {
		const next = current + delta;
		if (next < 1 || next > pageCount) return;
		current = next;
		// Keep the box's relative position when moving between pages of the same size.
		const keep = viewport ? { ...box } : null;
		await renderPage(false);
		if (keep) box = clamp(keep);
	}

	// Pointer gestures: drag the box, drag its handle to resize (keeping the image's proportions),
	// or press anywhere on the page to move the box there.
	let gesture: { mode: 'move' | 'resize'; startX: number; startY: number; from: typeof box } | null =
		null;

	function point(event: PointerEvent): [number, number] {
		const bounds = stage!.getBoundingClientRect();
		return [event.clientX - bounds.left, event.clientY - bounds.top];
	}

	function begin(event: PointerEvent, mode: 'move' | 'resize') {
		event.stopPropagation();
		event.preventDefault();
		const [x, y] = point(event);
		gesture = { mode, startX: x, startY: y, from: { ...box } };
		stage?.setPointerCapture(event.pointerId);
	}

	function jump(event: PointerEvent) {
		if (status !== 'ready') return;
		const [x, y] = point(event);
		box = clamp({ ...box, x: x - box.width / 2, y: y - box.height / 2 });
		begin(event, 'move');
	}

	function drag(event: PointerEvent) {
		if (!gesture) return;
		const [x, y] = point(event);
		const dx = x - gesture.startX;
		const dy = y - gesture.startY;
		if (gesture.mode === 'move') {
			box = clamp({ ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy });
		} else {
			const width = Math.max(gesture.from.width + Math.max(dx, dy * aspect), 24);
			box = clamp({ ...gesture.from, width, height: width / aspect });
		}
	}

	function end(event: PointerEvent) {
		gesture = null;
		if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
	}

	function nudge(event: KeyboardEvent) {
		const step = event.altKey ? 1 : 8;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		if (event.shiftKey) {
			const width = box.width + (move[0] || -move[1]);
			box = clamp({ ...box, width, height: width / aspect });
		} else {
			box = clamp({ ...box, x: box.x + move[0], y: box.y + move[1] });
		}
	}

	function apply() {
		if (!viewport) return;
		// Viewport y grows downwards, PDF y upwards: convert both corners and normalise.
		const [ax, ay] = viewport.convertToPdfPoint(box.x, box.y + box.height);
		const [bx, by] = viewport.convertToPdfPoint(box.x + box.width, box.y);
		const round = (value: number) => Math.round(value * 100) / 100;
		onapply(current, [
			round(Math.min(ax, bx)),
			round(Math.min(ay, by)),
			round(Math.max(ax, bx)),
			round(Math.max(ay, by))
		]);
		open = false;
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-h-[95dvh] overflow-y-auto sm:max-w-3xl">
		<DialogHeader>
			<DialogTitle>{copy.placeTitle}</DialogTitle>
			<DialogDescription>{copy.placeHint}</DialogDescription>
		</DialogHeader>

		<div class="flex items-center justify-center gap-2 text-sm">
			<Button
				variant="outline"
				size="icon"
				class="size-8"
				aria-label={copy.placePrev}
				disabled={status !== 'ready' || current <= 1}
				onclick={() => go(-1)}
			>
				<ChevronLeftIcon class="size-4" />
			</Button>
			<span class="tnum min-w-28 text-center" aria-live="polite">
				{copy.visiblePage}
				{current}
				{copy.placeOf}
				{pageCount || '…'}
			</span>
			<Button
				variant="outline"
				size="icon"
				class="size-8"
				aria-label={copy.placeNext}
				disabled={status !== 'ready' || current >= pageCount}
				onclick={() => go(1)}
			>
				<ChevronRightIcon class="size-4" />
			</Button>
		</div>

		<div class="bg-muted/60 flex min-h-64 justify-center overflow-hidden rounded-lg p-3">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				bind:this={stage}
				class="relative touch-none shadow-md select-none"
				class:cursor-crosshair={status === 'ready'}
				onpointerdown={jump}
				onpointermove={drag}
				onpointerup={end}
				onpointercancel={end}
			>
				<canvas bind:this={canvas} class="block bg-white"></canvas>
				{#if status === 'ready'}
					<div
						role="slider"
						tabindex="0"
						aria-label={copy.placeBox}
						aria-valuenow={Math.round(box.x)}
						class="border-primary bg-primary/5 focus-visible:ring-ring absolute cursor-move rounded-sm border-2 border-dashed focus-visible:ring-2 focus-visible:outline-none"
						style:left="{box.x}px"
						style:top="{box.y}px"
						style:width="{box.width}px"
						style:height="{box.height}px"
						onpointerdown={(event) => begin(event, 'move')}
						onkeydown={nudge}
					>
						{#if imageUrl}
							<img src={imageUrl} alt="" class="pointer-events-none size-full object-contain" />
						{/if}
						<span
							aria-label={copy.placeResize}
							role="presentation"
							class="bg-primary border-background absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-full border-2"
							onpointerdown={(event) => begin(event, 'resize')}
						></span>
					</div>
				{/if}
				{#if status === 'loading'}
					<div class="text-muted-foreground absolute inset-0 grid place-items-center gap-2 text-sm">
						<span class="flex items-center gap-2"><Spinner class="size-4" />{copy.placeLoading}</span>
					</div>
				{:else if status === 'error'}
					<p class="text-destructive p-8 text-sm" role="alert">{copy.placeError}</p>
				{/if}
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>{copy.placeCancel}</Button>
			<Button disabled={status !== 'ready'} onclick={apply}>{copy.placeApply}</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
