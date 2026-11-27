'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MutationError, PageHeader } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';

export function NewBrandForm() {
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [language, setLanguage] = useState('en');

  const create = useMutation({
    mutationFn: () => {
      const site = website.trim();
      return unwrap(
        api.POST('/api/brands', {
          body: {
            name: name.trim(),
            website: site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null,
            defaultLanguage: language,
            languages: language === 'ne' ? ['ne', 'en'] : ['en', 'ne'],
          },
        }),
      );
    },
    onSuccess: async (brand) => {
      await client.invalidateQueries({ queryKey: ['brands'] });
      client.setQueryData(['brand', brand.id], brand);
      router.push(`/app/b/${brand.id}/brand`);
    },
  });

  return (
    <>
      <PageHeader title="New brand" description="Start with the name and website. Everything else comes from the brand’s own pages and files, and you approve it." />
      <form
        className="panel grid max-w-xl gap-5 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="brand-name" className="label">Brand name</label>
          <input id="brand-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="brand-website" className="label">Website <span className="font-normal text-muted">(optional)</span></label>
          <input
            id="brand-website" className="input" value={website} onChange={(e) => setWebsite(e.target.value)}
            inputMode="url" autoComplete="url" placeholder="himalpashmina.com.np" aria-describedby="brand-website-hint"
          />
          <p id="brand-website-hint" className="hint">Prachaar reads this site when you import the brand.</p>
        </div>
        <div className="field">
          <label htmlFor="brand-language" className="label">Main language</label>
          <select id="brand-language" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="ne">नेपाली (Nepali)</option>
          </select>
        </div>
        <MutationError error={create.error} />
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn btn-primary" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Adding…' : 'Add brand'}
          </button>
          <Link href="/app/brands" className="btn btn-quiet">Cancel</Link>
        </div>
      </form>
    </>
  );
}
