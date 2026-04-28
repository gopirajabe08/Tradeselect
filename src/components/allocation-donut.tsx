"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = [
  "hsl(221 83% 53%)", "hsl(142 71% 45%)", "hsl(38 92% 50%)",
  "hsl(0 84% 60%)", "hsl(262 83% 58%)", "hsl(190 85% 45%)",
];

export function AllocationDonut({ data }: { data: { name: string; value: number; pct: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            formatter={(v: number, n: string) => [
              new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(v),
              n,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationLegend({ data }: { data: { name: string; value: number; pct: number }[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {data.map((d, i) => (
        <li key={d.name} className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            {d.name}
          </span>
          <span className="text-muted-foreground">{d.pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}
