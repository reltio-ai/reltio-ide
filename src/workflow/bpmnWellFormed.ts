/**
 * A small well-formedness check for BPMN text, so the diagram preview can say *why* it cannot
 * draw a file instead of showing an empty canvas.
 *
 * `bpmnModel.ts` reads elements with bounded regexes and believes the document is well-formed;
 * on a broken file it quietly returns a thin or empty model. This is the one place that notices
 * the breakage. It checks only what a reader needs to be told: unterminated comments, CDATA,
 * processing instructions and quotes, closing tags that do not match, elements never closed,
 * and a document with no element at all. It is not a validator, and accepts everything a
 * conforming parser accepts that these checks do not cover.
 *
 * Pure: no `vscode`, no I/O.
 */

export interface XmlProblem {
	/** What is wrong, in a sentence a user can act on. */
	readonly message: string;
	/** Character offset the problem was detected at. */
	readonly offset: number;
	/** 1-based line of `offset`. */
	readonly line: number;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

function lineOf(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
	return line;
}

/** First well-formedness problem in `xml`, or `undefined` when none of the checked kinds is present. */
export function findXmlProblem(xml: string): XmlProblem | undefined {
	const problem = (message: string, offset: number): XmlProblem => ({
		message,
		offset,
		line: lineOf(xml, offset),
	});

	const stack: Array<{ name: string; offset: number }> = [];
	let sawElement = false;
	let i = 0;

	while (i < xml.length) {
		const lt = xml.indexOf('<', i);
		if (lt < 0) break;

		if (xml.startsWith('<!--', lt)) {
			const end = xml.indexOf('-->', lt + 4);
			if (end < 0) return problem('A comment (<!--) is never closed with -->.', lt);
			i = end + 3;
			continue;
		}
		if (xml.startsWith('<![CDATA[', lt)) {
			const end = xml.indexOf(']]>', lt + 9);
			if (end < 0) return problem('A CDATA section is never closed with ]]>.', lt);
			i = end + 3;
			continue;
		}
		if (xml.startsWith('<?', lt)) {
			const end = xml.indexOf('?>', lt + 2);
			if (end < 0) return problem('A processing instruction (<?) is never closed with ?>.', lt);
			i = end + 2;
			continue;
		}
		if (xml.startsWith('<!', lt)) {
			const end = xml.indexOf('>', lt + 2);
			if (end < 0) return problem('A declaration (<!) is never closed with >.', lt);
			i = end + 1;
			continue;
		}

		if (xml[lt + 1] === '/') {
			let j = lt + 2;
			while (j < xml.length && NAME_CHAR.test(xml[j])) j++;
			const name = xml.slice(lt + 2, j);
			while (j < xml.length && /\s/.test(xml[j])) j++;
			if (name.length === 0 || xml[j] !== '>') {
				return problem('A closing tag is malformed.', lt);
			}
			const open = stack.pop();
			if (!open) return problem(`</${name}> closes an element that was never opened.`, lt);
			if (open.name !== name) {
				return problem(
					`</${name}> does not match the open <${open.name}> (opened on line ${lineOf(xml, open.offset)}).`,
					lt,
				);
			}
			i = j + 1;
			continue;
		}

		if (!NAME_START.test(xml[lt + 1] ?? '')) {
			return problem('A "<" is not the start of a tag. Write a literal "<" as &lt;.', lt);
		}
		let j = lt + 1;
		while (j < xml.length && NAME_CHAR.test(xml[j])) j++;
		const name = xml.slice(lt + 1, j);
		sawElement = true;

		// Attributes: walk to the closing ">" while respecting quoted values, which may contain ">".
		let selfClosing = false;
		let closed = false;
		while (j < xml.length) {
			const ch = xml[j];
			if (ch === '"' || ch === "'") {
				const endQuote = xml.indexOf(ch, j + 1);
				if (endQuote < 0) return problem(`An attribute value in <${name}> is missing its closing quote.`, j);
				j = endQuote + 1;
				continue;
			}
			if (ch === '/' && xml[j + 1] === '>') {
				selfClosing = true;
				j += 2;
				closed = true;
				break;
			}
			if (ch === '>') {
				j += 1;
				closed = true;
				break;
			}
			if (ch === '<') return problem(`<${name}> is missing its closing ">".`, lt);
			j++;
		}
		if (!closed) return problem(`<${name}> is missing its closing ">".`, lt);
		if (!selfClosing) stack.push({ name, offset: lt });
		i = j;
	}

	const unclosed = stack.pop();
	if (unclosed) {
		return problem(`<${unclosed.name}> is never closed (opened on line ${lineOf(xml, unclosed.offset)}).`, unclosed.offset);
	}
	if (!sawElement) return problem('The file has no XML element.', 0);
	return undefined;
}
