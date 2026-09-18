import { AccountBoundary } from '../components/providers/account.tsx';
import { Hub } from '../features/workspace/index.ts';
export default function HomePage() {
  return (
    <AccountBoundary>
      <Hub />
    </AccountBoundary>
  );
}
