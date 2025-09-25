import React from "react";

export default function TradesTable({ rows }){
  if (!rows?.length) return <div>No trades</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>Dir</Th>
            <Th>Entry</Th>
            <Th>SL</Th>
            <Th>TP</Th>
            <Th>Lot</Th>
            <Th>Exit</Th>
            <Th>PnL</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i)=>(
            <tr key={i} style={{ borderTop: "1px solid #eee" }}>
              <Td>{new Date(r.time).toLocaleString()}</Td>
              <Td>{r.dir}</Td>
              <Td>{r.entry.toFixed(5)}</Td>
              <Td>{r.sl.toFixed(5)}</Td>
              <Td>{r.tp.toFixed(5)}</Td>
              <Td>{r.lot.toFixed(2)}</Td>
              <Td>{r.exit ? r.exit.toFixed(5) : "-"}</Td>
              <Td style={{ color: r.pnl >=0 ? "green" : "crimson" }}>{r.pnl.toFixed(2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) { return <th style={{ textAlign: "left", padding: 8 }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: 8 }}>{children}</td>; }