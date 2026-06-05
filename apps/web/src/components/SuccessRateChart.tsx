import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

export function SuccessRateChart({ success, failed }: { success: number; failed: number }) {
  const data = [
    { name: "성공", value: success },
    { name: "실패", value: failed },
  ];
  const colors = ["#22c55e", "#ef4444"];
  return (
    <div className="chart" style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
          <Legend />
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
