import data from './sample-data';
import type { AnalysisData } from './data';
// Official template fixtures, explicitly labelled as examples in the page.
export async function fakeChartData(): Promise<{ data: AnalysisData }> {
  return { data };
}
