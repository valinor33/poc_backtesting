import React from "react";
import { LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Line, ResponsiveContainer } from "recharts";

export default function EquityChart({ data }){
  const formatted = data.map(d => ({
    t: new Date(d.t).toLocaleString(),
    equity: Number(d.equity.toFixed(2))
  }));
  return (
    <div style={{ width:"100%", height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="equity" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}