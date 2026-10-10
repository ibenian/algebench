/** Read scene table rows or a cell without changing the underlying data. */
export function readDataTable(data:Record<string,unknown>|null,table:unknown,rowIndex?:unknown,column?:unknown):unknown {
    const rows=data?.[String(table)];
    if(!Array.isArray(rows))return 0;
    if(rowIndex===undefined&&column===undefined)return rows;
    const row=rows[Math.max(0,Math.min(rows.length-1,Math.round(Number(rowIndex))))];
    if(!row)return 0;
    const value=(row as Record<string,unknown>)[String(column)];
    return value!=null?value:0;
}

/** Materialize a derived table before reading its rows or a cell. */
export function createBoundTableReader() {
    const resolving = new Set<string>();
    return function read(data:Record<string,unknown>, bindings:readonly {table:string;rowsExpr:string}[],
        table:unknown, rowIndex:unknown, column:unknown, evaluate:(expression:string)=>unknown):unknown {
        const name=String(table), binding=bindings.find(binding=>binding.table===name);
        if(binding) {
            if(resolving.has(name)) throw new Error('Circular data table binding: '+name);
            resolving.add(name);
            try {
                const result=evaluate(binding.rowsExpr) as {toArray?:()=>unknown}|null;
                const rows=result && typeof result.toArray==='function'?result.toArray():result;
                if(!Array.isArray(rows) || rows.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw new Error('Table binding must return row objects: '+name);
                data[name]=rows;
            } finally { resolving.delete(name); }
        }
        return readDataTable(data,table,rowIndex,column);
    };
}
