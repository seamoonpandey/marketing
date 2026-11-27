import { BrandNav } from '@/components/brand/subnav';

export default function BrandModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandNav />
      {children}
    </>
  );
}
