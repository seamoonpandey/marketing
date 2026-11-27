import type { Metadata } from 'next';
import { NewBrandForm } from './new-brand-form';

export const metadata: Metadata = { title: 'New brand' };

export default function NewBrandPage() {
  return <NewBrandForm />;
}
