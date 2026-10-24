/** Read scene table rows or a cell without changing the underlying data. */
/** dataTable(table) → its rows; dataTable(table, 'column') → that column, one value per row (0 where missing);
 *  dataTable(table, row, 'column') → one cell, the row clamped and rounded. */
export function readDataTable(data:Record<string,unknown>|null,table:unknown,rowIndex?:unknown,column?:unknown):unknown {
    const rows=data?.[String(table)];
    if(!Array.isArray(rows))return 0;
    if(rowIndex===undefined&&column===undefined)return rows;
    if(column===undefined&&typeof rowIndex==='string')return rows.map(row=>{const v=(row as Record<string,unknown>)?.[rowIndex];return v!=null?v:0;});
    const row=rows[Math.max(0,Math.min(rows.length-1,Math.round(Number(rowIndex))))];
    if(!row)return 0;
    const value=(row as Record<string,unknown>)[String(column)];
    return value!=null?value:0;
}

/** Materialize a derived table before reading its rows or a cell. An epoch of undefined disables reuse.
 *
 *  `epoch` names the moment the scene's inputs were last able to change. While it
 *  returns the same value, a binding is evaluated once and its rows are reused:
 *  views read a bound table once per cell per frame, and re-running the binding
 *  for each of those reads was most of a frame's cost. Without `epoch` every read
 *  evaluates, as before. */
export function createBoundTableReader(epoch?: () => unknown) {
    const resolving = new Set<string>();
    const memo = new Map<string, {epoch: unknown; rowsExpr: string; data: Record<string,unknown>}>();
    return function read(data:Record<string,unknown>, bindings:readonly {table:string;rowsExpr:string}[],
        table:unknown, rowIndex:unknown, column:unknown, evaluate:(expression:string)=>unknown):unknown {
        const name=String(table), binding=bindings.find(binding=>binding.table===name);
        const now=epoch?.();
        const hit=binding && now!==undefined ? memo.get(name) : undefined;
        if(binding && hit && hit.epoch===now && hit.rowsExpr===binding.rowsExpr && hit.data===data && Array.isArray(data[name])) {
            return readDataTable(data,table,rowIndex,column);
        }
        if(binding) {
            if(resolving.has(name)) throw new Error('Circular data table binding: '+name);
            resolving.add(name);
            try {
                const result=evaluate(binding.rowsExpr) as {toArray?:()=>unknown}|null;
                const rows=result && typeof result.toArray==='function'?result.toArray():result;
                if(!Array.isArray(rows) || rows.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw new Error('Table binding must return row objects: '+name);
                data[name]=rows;
                if(now!==undefined) memo.set(name,{epoch:now,rowsExpr:binding.rowsExpr,data});
            } finally { resolving.delete(name); }
        }
        return readDataTable(data,table,rowIndex,column);
    };
}
