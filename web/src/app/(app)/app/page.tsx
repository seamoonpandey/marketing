import { redirect } from 'next/navigation';

// Home is the brand list until the product has a dashboard.
export default function Home() {
  redirect('/app/brands');
}
