/** A deterministic repair policy, not a minimum-edit optimizer. */
export const REPAIR_SOURCE = `def repair(text):
    chars = list(text)
    pairs = {'(': ')', '[': ']', '{': '}'}
    openers = {')': '(', ']': '[', '}': '{'}
    stack = []
    i = 0
    while i < len(chars):
        ch = chars[i]
        if ch in pairs:
            stack.append(i)
        elif ch in openers:
            if not stack:
                chars.insert(i, openers[ch])
                i += 1
            else:
                top = stack[-1]
                expected = pairs[chars[top]]
                if ch != expected:
                    chars[i] = expected
                stack.pop()
        i += 1
    while stack:
        chars.append(pairs[chars[stack.pop()]])
    return ''.join(chars)`;

export function repairTrace(text: string) {
    const chars = [...text];
    if (chars.length > 128) throw new Error('Repair supports at most 128 input characters (256 after insertion).');
    const pairs: Record<string, string> = {'(': ')', '[': ']', '{': '}'};
    const openers: Record<string, string> = {')': '(', ']': '[', '}': '{'};
    const stack: number[] = [];
    let i = 0, ch = '', top = -1, expected = '', edits = 0;
    const trace: Array<{
        line: number; i: number; ch: string; top: number; expected: string;
        chars: string[]; stack: number[]; n: number; edits: number;
        running: number; hasExpected: number; status: string; message: string;
    }> = [];
    const emit = (line: number, message: string, done = false) => trace.push({
        line, i, ch, top, expected, chars: chars.slice(), stack: stack.slice(),
        n: stack.length, edits, running: done ? 0 : 1, hasExpected: expected ? 1 : 0,
        status: done ? 'Valid' : 'Repairing', message,
    });
    emit(6, 'Start with a mutable character array and an empty stack.');
    while (i < chars.length) {
        expected = ''; ch = chars[i]!;
        emit(8, `Read ${JSON.stringify(ch)} at index ${i}.`);
        emit(9, 'Check whether this is an opener.');
        if (Object.hasOwn(pairs, ch)) {
            stack.push(i); emit(10, `Push opener index ${i}.`);
        } else {
            emit(11, 'Check whether this is a closer.');
            if (Object.hasOwn(openers, ch)) {
                emit(12, 'Check whether an unmatched opener exists.');
                if (!stack.length) {
                    chars.splice(i, 0, openers[ch]!); edits++;
                    emit(13, `Insert ${openers[ch]} before the orphan closer ${ch}.`);
                    i++; emit(14, 'Skip the inserted opener; this pair is already complete.');
                } else {
                    top = stack.at(-1)!; emit(16, `Peek at opener index ${top}.`);
                    expected = pairs[chars[top]!]!; emit(17, `The stack top requires ${expected}.`);
                    emit(18, `Compare ${ch} with ${expected}.`);
                    if (ch !== expected) {
                        chars[i] = expected; edits++;
                        emit(19, `Replace ${ch} with ${expected} to close the most recent opener.`);
                    }
                    stack.pop(); emit(20, 'The pair is complete; pop its opener.');
                }
            } else emit(11, 'Preserve ordinary text unchanged.');
        }
        i++; emit(21, 'Advance to the next character.');
    }
    while (stack.length) {
        emit(22, 'An unmatched opener still needs a closer.');
        top = stack.pop()!; expected = pairs[chars[top]!]!;
        i = chars.length; chars.push(expected); ch = expected; edits++;
        emit(23, `Append ${expected} to close opener index ${top}.`);
    }
    expected = ''; i = chars.length - 1; ch = chars.at(-1) ?? '';
    emit(24, `Valid result: ${JSON.stringify(chars.join(''))}. ${edits} edit${edits === 1 ? '' : 's'}.`, true);
    return trace;
}
