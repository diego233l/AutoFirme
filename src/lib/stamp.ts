/**
 * Image-only "signature": a picture of a handwritten signature drawn onto a PDF page, with no
 * certificate and no cryptographic signature. It is a visual stamp, not an electronic signature;
 * the UI says so. When a certificate is available, PAdES with `style: 'image'` (pades-visible.ts)
 * draws the same picture *inside* a real signature instead.
 */

import { PDFDocument } from 'pdf-lib';

import { toBytes, type Bytes } from './der';
import { imageFormat, rectForCorner } from './pades-visible';

export interface StampOptions {
	/** Zero-based page index. */
	page: number;
	/** `[x1, y1, x2, y2]` in PDF user space (origin bottom-left), as `signPdf`'s `visible.rect`.
	 * Defaults to the bottom-right corner block. */
	rect?: [number, number, number, number];
	/** PNG or JPEG bytes. */
	image: ArrayBuffer | ArrayBufferView;
}

export async function stampPdf(source: ArrayBuffer | ArrayBufferView, options: StampOptions): Promise<Bytes> {
	const document = await PDFDocument.load(toBytes(source), { updateMetadata: false });
	if (document.isEncrypted) throw new Error('encrypted PDFs cannot be stamped');
	const page = document.getPages()[options.page];
	if (!page) throw new Error(`input PDF has no page ${options.page}`);

	const bytes = toBytes(options.image);
	const format = imageFormat(bytes);
	if (format === null) throw new Error('signature image must be PNG or JPEG');
	const image = format === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);

	// Same fit as the PAdES image-only appearance: keep the aspect ratio, centre in the rectangle.
	const [x1, y1, x2, y2] = options.rect ?? rectForCorner(page.getSize(), 'bottom-right');
	const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
	const scale = Math.min(box.width / image.width, box.height / image.height);
	const width = image.width * scale;
	const height = image.height * scale;
	page.drawImage(image, {
		x: box.x + (box.width - width) / 2,
		y: box.y + (box.height - height) / 2,
		width,
		height
	});
	return new Uint8Array(await document.save());
}
