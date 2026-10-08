/** Display-only source and complete, immutable execution snapshots for bracket validation. */
export const BRACKET_SOURCE = `def validate(text):
    closers = {')': '(', ']': '[', '}': '{'}
    stack = []
    for i, ch in enumerate(text):
        if ch in '([{':
            stack.append(i)
        elif ch in closers:
            if not stack:
                return False
            top = stack[-1]
            if text[top] != closers[ch]:
                return False
            stack.pop()
    return not stack`;
export interface BracketFrame {
    line:number;
    i:number;
    ch:string;
    stack:number[];
    n:number;
    top:number;
    expected:string;
    status:'Running'|'Valid'|'Invalid';
    message:string;
    matchedOpen:number;
    matchedClose:number;
    running:number;
    hasExpected:number;
}
export function bracketTrace(text:string):BracketFrame[] {
    const chars=[...text];
    if(chars.length>256)throw new Error('The bracket visualization supports at most 256 characters.');
    const closers:Record<string,string>={')':'(',']':'[','}':'{'};
    const stack:number[]=[],trace:BracketFrame[]=[];
    let i=-1,ch='',top=-1,expected='',matchedOpen=-1,matchedClose=-1;
    const emit=(line:number,message:string,status:BracketFrame['status']='Running')=>trace.push({line,i,ch,stack:stack.slice(),n:stack.length,top,expected,status,message,matchedOpen,matchedClose,running:status==='Running'?1:0,hasExpected:expected?1:0});
    emit(3,'Start with an empty stack of opening-character positions.');
    for(i=0;i<chars.length;i++){
        ch=chars[i]!;expected=closers[ch]??'';matchedOpen=matchedClose=-1;
        emit(4,`Read character ${JSON.stringify(ch)} at index ${i}.`);
        emit(5,'Is this character an opening bracket?');
        if('([{'.includes(ch)){
            stack.push(i);emit(6,`Push index ${i}: ${ch} is waiting for its closing bracket.`);continue;
        }
        emit(7,'Is this character a closing bracket?');
        if(!Object.hasOwn(closers,ch)){
            emit(7,`Ignore ${JSON.stringify(ch)}; only bracket characters affect the stack.`);continue;
        }
        expected=closers[ch]!;
        emit(8,'A closing bracket needs an opening bracket on the stack.');
        if(!stack.length){emit(9,`Invalid: ${ch} at index ${i} has no opening bracket.`,'Invalid');return trace;}
        top=stack.at(-1)!;emit(10,`Peek at the most recent opener: index ${top}, ${chars[top]}.`);
        emit(11,`Compare ${chars[top]} with the required opener ${expected}.`);
        if(chars[top]!==expected){emit(12,`Invalid: ${ch} needs ${expected}, but the stack top is ${chars[top]}.`,'Invalid');return trace;}
        stack.pop();matchedOpen=top;matchedClose=i;
        emit(13,`Matched ${chars[top]}${ch}: pop index ${top} from the stack.`);
    }
    i=chars.length-1;ch=chars.at(-1)??'';expected=closers[ch]??'';matchedOpen=matchedClose=-1;
    emit(14,stack.length?`Invalid: ${stack.length} opening bracket${stack.length===1?' is':'s are'} still unclosed.`:'Valid: the input ended and the stack is empty.',stack.length?'Invalid':'Valid');
    return trace;
}
