import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'data_table' }>;

export default function DataTable({ headers, rows, title }: Props) {
  return (
    <div className="view data-table-view">
      {title && <h2 className="view__title">{title}</h2>}
      <div className="data-table-view__scroll">
        <table className="data-table-view__table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
