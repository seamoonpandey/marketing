// The one field catalogue (requirements spec §5, lines 1038–1050). It drives the extraction schema,
// the review screens, conflict detection and readiness.

export type SectionKey =
  | 'identity' | 'business_model' | 'products' | 'audience' | 'positioning'
  | 'voice' | 'visual' | 'legal' | 'goals';

export type FieldDef = {
  key: string;
  label: string;
  /** True when a subject may hold several facts for this field (each its own source); these never conflict. */
  multi: boolean;
  /** The owner is asked for an expiry date (prices, offers). */
  asksExpiry?: boolean;
  options?: string[];
  type: 'text' | 'longtext' | 'number' | 'money' | 'enum' | 'list' | 'url' | 'date';
};

export type SectionDef = { key: SectionKey; label: string; subject: 'brand' | 'product' | 'segment'; fields: FieldDef[] };

const f = (key: string, label: string, type: FieldDef['type'], more: Partial<FieldDef> = {}): FieldDef => ({
  key, label, type, multi: false, ...more,
});
const many = { multi: true };

export const CATALOGUE: SectionDef[] = [
  {
    key: 'identity', label: 'Identity', subject: 'brand',
    fields: [
      f('legal_name', 'Legal name', 'text'),
      f('trading_name', 'Trading name', 'text'),
      f('slug', 'Slug', 'text'),
      f('website', 'Website', 'url'),
      f('country', 'Country', 'text'),
      f('timezone', 'Timezone', 'text'),
      f('currency', 'Currency', 'text'),
      f('default_language', 'Default language', 'text'),
      f('additional_languages', 'Additional languages', 'list'),
      f('industry', 'Industry', 'text'),
      f('sub_industry', 'Sub-industry', 'text'),
      f('business_model', 'Business model', 'text'),
      f('company_stage', 'Company stage', 'enum', { options: ['idea', 'startup', 'growth', 'established'] }),
      f('owner', 'Owner', 'text'),
      f('contacts', 'Contacts', 'text', many),
    ],
  },
  {
    key: 'business_model', label: 'Business model', subject: 'brand',
    fields: [
      f('type', 'Type', 'enum', {
        ...many,
        options: ['b2b', 'b2c', 'b2b2c', 'marketplace', 'subscription', 'services', 'e_commerce', 'local'],
      }),
      f('sales_cycle', 'Sales cycle', 'text'),
      f('average_order_value', 'Average order value', 'money'),
      f('recurring_revenue', 'Recurring revenue', 'text'),
      f('margin_range', 'Margin range', 'text'),
      f('capacity', 'Capacity', 'text'),
      f('geography', 'Geography', 'list'),
      f('delivery_method', 'Delivery method', 'text'),
    ],
  },
  {
    key: 'products', label: 'Products and services', subject: 'product',
    fields: [
      f('sku', 'SKU or service ID', 'text'),
      f('name', 'Name', 'text'),
      f('category', 'Category', 'text'),
      f('description', 'Description', 'longtext'),
      f('features', 'Features', 'text', many),
      f('benefits', 'Benefits', 'text', many),
      f('eligibility', 'Eligibility', 'text'),
      f('exclusions', 'Exclusions', 'text'),
      f('price', 'Price', 'money', { asksExpiry: true }),
      f('billing_unit', 'Billing unit', 'text'),
      f('variants', 'Variants', 'list'),
      f('availability', 'Availability', 'text'),
      f('warranty', 'Warranty', 'text'),
      f('delivery', 'Delivery', 'text'),
      f('support', 'Support', 'text'),
      f('url', 'URL', 'url'),
      f('approved_assets', 'Approved assets', 'list'),
      f('claims', 'Claims', 'text', many),
    ],
  },
  {
    key: 'audience', label: 'Audience', subject: 'segment',
    fields: [
      f('geography', 'Geography', 'text'),
      f('language', 'Language', 'text'),
      f('problem', 'Problem', 'longtext'),
      f('desired_outcome', 'Desired outcome', 'longtext'),
      f('trigger', 'Trigger', 'text'),
      f('objections', 'Objections', 'text', many),
      f('alternatives', 'Alternatives', 'list'),
      f('decision_maker', 'Decision maker', 'text'),
      f('budget_sensitivity', 'Budget sensitivity', 'enum', { options: ['low', 'medium', 'high'] }),
      f('funnel_stage', 'Funnel stage', 'enum', { options: ['awareness', 'consideration', 'decision', 'retention'] }),
      f('evidence', 'Evidence or sample', 'longtext'),
      f('last_validated', 'Last validated', 'date'),
    ],
  },
  {
    key: 'positioning', label: 'Positioning', subject: 'brand',
    fields: [
      f('category', 'Category', 'text'),
      f('purpose', 'Purpose', 'longtext'),
      f('mission', 'Mission', 'longtext'),
      f('vision', 'Vision', 'longtext'),
      f('promise', 'Promise', 'longtext'),
      f('positioning', 'Positioning', 'longtext'),
      f('value_proposition', 'Value proposition', 'longtext'),
      f('differentiators', 'Differentiators', 'text', many),
      f('proof', 'Proof', 'text', many),
      f('narrative', 'Narrative', 'longtext'),
      f('prohibited_claims', 'Prohibited claims', 'list'),
    ],
  },
  {
    key: 'voice', label: 'Voice', subject: 'brand',
    fields: [
      f('traits', 'Traits', 'list'),
      f('channel_tone', 'Channel tone', 'longtext'),
      f('sentence_length', 'Sentence length', 'text'),
      f('vocabulary', 'Vocabulary', 'list'),
      f('prohibited_words', 'Prohibited words', 'list'),
      f('spelling', 'Spelling', 'text'),
      f('emoji', 'Emoji', 'enum', { options: ['none', 'sparing', 'frequent'] }),
      f('humour', 'Humour', 'enum', { options: ['none', 'light', 'playful'] }),
      f('person', 'Person', 'enum', { options: ['first_singular', 'first_plural', 'second', 'third'] }),
      f('cta', 'Call to action', 'text'),
      f('on_brand_examples', 'On-brand examples', 'longtext', many),
      f('off_brand_examples', 'Off-brand examples', 'longtext', many),
    ],
  },
  {
    // Logo variants are assets and colours are the palette; both have their own tables.
    key: 'visual', label: 'Visual identity', subject: 'brand',
    fields: [
      f('fonts', 'Licensed fonts', 'text', many),
      f('photo_style', 'Photo style', 'longtext'),
      f('illustration_style', 'Illustration style', 'longtext'),
      f('icon_style', 'Icon style', 'longtext'),
      f('grid', 'Grid', 'text'),
      f('spacing', 'Spacing', 'text'),
      f('templates', 'Templates', 'list'),
      f('aspect_ratios', 'Aspect ratios', 'list'),
      f('motion_rules', 'Motion rules', 'longtext'),
      f('mascot_rules', 'Mascot rules', 'longtext'),
      f('contrast', 'Contrast', 'text'),
    ],
  },
  {
    key: 'legal', label: 'Legal and trust', subject: 'brand',
    fields: [
      f('registration', 'Registration facts', 'text', many),
      f('licences', 'Licences', 'text', { ...many, asksExpiry: true }),
      f('certifications', 'Certifications', 'text', { ...many, asksExpiry: true }),
      f('disclaimers', 'Disclaimers', 'longtext', many),
      f('privacy_url', 'Privacy policy', 'url'),
      f('terms_url', 'Terms', 'url'),
      f('refund', 'Refund terms', 'longtext'),
      f('warranty', 'Warranty', 'longtext'),
      f('claim_evidence', 'Claim evidence', 'longtext', many),
      f('approval_owner', 'Approval owner', 'text'),
    ],
  },
  {
    key: 'goals', label: 'Goals and economics', subject: 'brand',
    fields: [
      f('primary_objective', 'Primary objective', 'text'),
      f('secondary_objective', 'Secondary objective', 'text'),
      f('baseline', 'Baseline', 'text'),
      f('target', 'Target', 'text'),
      f('period', 'Period', 'text'),
      f('kpis', 'KPIs', 'list'),
      f('monthly_budget', 'Monthly budget', 'money'),
      f('channel_budgets', 'Channel budgets', 'longtext'),
      f('asset_budgets', 'Asset budgets', 'longtext'),
      f('max_ai_spend', 'Maximum AI spend', 'money'),
      f('cost_per_video_target', 'Cost per video target', 'money'),
      f('cpl_target', 'Cost per lead target', 'money'),
      f('margin_floor', 'Margin floor', 'text'),
      f('approval_thresholds', 'Approval thresholds', 'text'),
      f('approvers', 'Approvers', 'list'),
    ],
  },
];

export function sectionDef(section: string): SectionDef | undefined {
  return CATALOGUE.find((s) => s.key === section);
}

export function fieldDef(section: string, field: string): FieldDef | undefined {
  return sectionDef(section)?.fields.find((x) => x.key === field);
}
