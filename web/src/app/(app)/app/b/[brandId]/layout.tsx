import { BrandScope } from '@/components/app';

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return <BrandScope>{children}</BrandScope>;
}
