/**
 * CMover::IsInteriorityJob: a classe `job` pode usar um item da classe `need`? Vagrant e a própria classe sempre; a 2ª classe
 * usa os da 1ª que a originou; Master/Hero/Legend Hero usam os da linha deles (mesmas contas do original).
 */
export function jobCanUse(need: number, job: number): boolean {
  if (need < 0 || need === 0 || need === job) return true;
  if (job >= 6 && job < 16 && need < 6) return need * 2 + 4 === job || need * 2 + 5 === job;
  if (job >= 16 && job < 24) return need < 6 ? need * 2 + 14 === job || need * 2 + 15 === job : need < 16 && need + 10 === job;
  if (job >= 24 && job < 32) return need < 6 ? need * 2 + 22 === job || need * 2 + 23 === job : need < 16 ? need + 18 === job : need < 24 && need + 8 === job;
  if (job >= 32 && job < 40) return need < 6 ? need * 2 + 30 === job || need * 2 + 31 === job : need < 16 ? need + 26 === job : need < 24 ? need + 16 === job : need < 32 && need + 8 === job;
  return false;
}
