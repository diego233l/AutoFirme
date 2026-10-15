import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';

import { stampPdf } from './stamp';

/** 24×12 RGBA PNG, the same synthetic signature image the PAdES tests use. */
const SIGNATURE_IMAGE = new Uint8Array(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAABgAAAAMCAYAAAB4MH11AAABXklEQVR42hXNER+nMAAA0Ph4HI/jP8fjeBwP7xeP4zgex+M47mvcveDxG4bh7/CHwEhkGv7++zGTWMisFDYqOwcnjYvOzcPLMAQBgZHIFATMJBYyK4WNys7BSeOic/Pwhi+IAgIjkSkKmEksZFYKG5Wdg5PGRefm4Y1f8BMQGIlMPwEziYXMSmGjsnNw0rjo3Dy8vy9IAgIjkSkJmEksZFYKG5Wdg5PGRefm4U1fkAUERiJTFjCTWMisFDYqOwcnjYvOzcObv6AICIxEpiJgJrGQWSlsVHYOThoXnZuHt3xBFRAYiUxVwExiIbNS2KjsHJw0Ljo3D2/9gkNAYCQyHQJmEguZlcJGZefgpHHRuXl4jy9oAgIjkakJmEksZFYKG5Wdg5PGRefm4W1f0AUERiJTFzCTWMisFDYqOwcnjYvOzcPbv+AREBiJTI+AmcRCZqWwUdk5OGlcdG4eXv4D+N9wW2VveV4AAAAASUVORK5CYII=',
		'base64'
	)
);

async function twoPagePdf(): Promise<Uint8Array> {
	const document = await PDFDocument.create();
	document.addPage([595.28, 841.89]);
	document.addPage([595.28, 841.89]);
	return document.save();
}

/** Decoded content streams of a page, concatenated (pdf-lib appends the drawing as a new stream). */
function pageContent(document: PDFDocument, index: number): string {
	const page = document.getPages()[index].node;
	const contents = page.Contents();
	const streams = contents instanceof PDFStream ? [contents] : (contents?.asArray() ?? []).map((ref) => document.context.lookup(ref));
	return streams
		.map((stream) => {
			const raw = stream as PDFRawStream;
			return new TextDecoder('latin1').decode(decodePDFRawStream(raw).decode());
		})
		.join('\n');
}

describe('image-only stamp', () => {
	it('draws the image on the chosen page, fitted and centred in the rectangle', async () => {
		const stamped = await stampPdf(await twoPagePdf(), {
			page: 1,
			rect: [100, 200, 220, 300],
			image: SIGNATURE_IMAGE
		});
		const document = await PDFDocument.load(stamped);

		expect(pageContent(document, 0)).not.toContain(' Do');
		const content = pageContent(document, 1);
		// 24×12 into 120×100 scales ×5 → 120×60, centred vertically: y = 200 + (100 - 60) / 2 = 220.
		// pdf-lib writes the translation and the scale as separate `cm` operators.
		expect(content).toContain('1 0 0 1 100 220 cm');
		expect(content).toContain('120 0 0 60 0 0 cm');
		expect(content).toMatch(/\/Image-\d+ Do/);

		const resources = document.getPages()[1].node.Resources() as PDFDict;
		const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
		expect(xobjects.keys()).toHaveLength(1);
	});

	it('refuses a missing page and a non-image file', async () => {
		const source = await twoPagePdf();
		await expect(stampPdf(source, { page: 5, rect: [0, 0, 10, 10], image: SIGNATURE_IMAGE })).rejects.toThrow(
			/no page 5/
		);
		await expect(
			stampPdf(source, { page: 0, rect: [0, 0, 10, 10], image: new Uint8Array([0x47, 0x49, 0x46, 0x38]) })
		).rejects.toThrow(/PNG or JPEG/);
	});
});
