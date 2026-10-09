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
