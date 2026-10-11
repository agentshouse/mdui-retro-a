import type {Attribution} from './model';
/** Attribution is Provider head metadata, never an App-claimed creator/current user. */
export function AttributionLabel({author,label='Last edited by'}:{author?:Attribution|null;label?:string}) {
  if(!author)return <span className="retro-attribution retro-attribution--unavailable" title="House has not supplied an author for this head revision. New queued documents are unattributed until accepted and refreshed.">{label}: unavailable</span>;
  return <span className="retro-attribution" title={`House's latest confirmed head author. Pending edits keep the previous confirmed attribution. ${author.kind}: ${author.id}`}>
    {label}: {author.name}{author.kind==='site'?' (site)':''}
  </span>;
}
