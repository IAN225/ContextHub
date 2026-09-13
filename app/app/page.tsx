import { AccountBoundary } from '@/components/hub/account';
import { Hub } from '@/components/hub/hub';
export default function HomePage() {
  return (
    <AccountBoundary>
      <Hub />
    </AccountBoundary>
  );
}
