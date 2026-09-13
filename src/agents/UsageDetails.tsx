import {tokenUsageRows,type ToolTokenUsage} from './usage';

export function UsageDetails({usage}:{usage:ToolTokenUsage|null}) {
  if (usage === null) return <p className="agent-usage-note">Token usage was not recorded for this saved task.</p>;
  return <div className="agent-usage">
    <table>
      <caption>Reported token usage</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">Tokens</th><th scope="col">Reporting calls</th></tr></thead>
      <tbody>{tokenUsageRows(usage).map(row => <tr key={row.label}>
        <th scope="row">{row.label}</th>
        <td>{row.tokens === null ? 'Unknown' : row.tokens.toLocaleString()}</td>
        <td>{row.reportedCalls} of {row.modelCalls}</td>
      </tr>)}</tbody>
    </table>
    <p className="agent-usage-note">Provider-reported counts for this task. Missing reports stay unknown. These counts are not a billing total.</p>
  </div>;
}
