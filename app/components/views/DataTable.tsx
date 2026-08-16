import type { ViewSpec } from '@/lib/views';
import MathText from './MathText';

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
                  <MathText text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}><MathText text={cell} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
