import { applicationDatabase } from '../../application/server/runtime.ts';
import { workspaceApplication } from '../../application/server/workspaces.ts';
import { createImportRepository } from './repository.ts';
export function importRepository() {
  const db = applicationDatabase();
  return createImportRepository(db, workspaceApplication(db));
}
