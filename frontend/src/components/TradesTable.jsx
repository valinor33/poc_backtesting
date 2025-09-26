import React from "react";

export default function TradesTable({ rows }){
  if (!rows?.length) return <div className="muted">No trades</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <Th>Open Time</Th>
            <Th>Dir</Th>
            <Th>Entry</Th>
            <Th>SL</Th>
            <Th>TP</Th>
            <Th>Lot</Th>
            <Th>Exit</Th>
            <Th>Exit Time</Th>
            <Th>PnL</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i)=>(
            <tr key={i}>
              <Td>{new Date(r.time).toLocaleString()}</Td>
              <Td>{r.dir}</Td>
              <Td>{fmt(r.entry)}</Td>
              <Td>{fmt(r.sl)}</Td>
              <Td>{fmt(r.tp)}</Td>
              <Td>{r.lot?.toFixed(2)}</Td>
              <Td>{r.exit ? fmt(r.exit) : "-"}</Td>
              <Td>{r.exitTime ? new Date(r.exitTime).toLocaleString() : "-"}</Td>
              <Td style={{ color: r.pnl >=0 ? "green" : "crimson" }}>{r.pnl?.toFixed(2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(n){ return (n!==undefined && n!==null) ? Number(n).toFixed(5) : "-"; }

function Th({ children }) { return <th style={{ textAlign: "left", padding: 8 }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: 8 }}>{children}</td>; }