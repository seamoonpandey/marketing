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
  /** What a typical value looks like: shown to the owner as a typing hint, never sent to the model. */
  example?: string;
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
      f('legal_name', 'Legal name', 'text', { example: 'Ilam Leaf Co. Pvt. Ltd.' }),
      f('trading_name', 'Trading name', 'text', { example: 'Ilam Leaf Co.' }),
      f('slug', 'Slug', 'text', { example: 'ilam-leaf' }),
      f('website', 'Website', 'url', { example: 'https://ilamleaf.com.np' }),
      f('country', 'Country', 'text', { example: 'Nepal' }),
      f('timezone', 'Timezone', 'text', { example: 'Asia/Kathmandu' }),
      f('currency', 'Currency', 'text', { example: 'NPR' }),
      f('default_language', 'Default language', 'text', { example: 'Nepali' }),
      f('additional_languages', 'Additional languages', 'list', { example: 'English' }),
      f('industry', 'Industry', 'text', { example: 'Food and beverage' }),
      f('sub_industry', 'Sub-industry', 'text', { example: 'Specialty tea' }),
      f('business_model', 'Business model', 'text', { example: 'We grow, hand-roll and sell green tea directly to customers' }),
      f('company_stage', 'Company stage', 'enum', { options: ['idea', 'startup', 'growth', 'established'] }),
      f('owner', 'Owner', 'text', { example: 'Sunita Rai' }),
      f('contacts', 'Contacts', 'text', { ...many, example: 'Orders: orders@ilamleaf.com.np, 01-5551234' }),
    ],
  },
  {
    key: 'business_model', label: 'Business model', subject: 'brand',
    fields: [
      f('type', 'Type', 'enum', {
        ...many,
        options: ['b2b', 'b2c', 'b2b2c', 'marketplace', 'subscription', 'services', 'e_commerce', 'local'],
      }),
      f('sales_cycle', 'Sales cycle', 'text', { example: 'Same day for online orders, 2 weeks for wholesale' }),
      f('average_order_value', 'Average order value', 'money', { example: 'NPR 1,800' }),
      f('recurring_revenue', 'Recurring revenue', 'text', { example: 'About 30% of orders are monthly subscriptions' }),
      f('margin_range', 'Margin range', 'text', { example: '35% to 45%' }),
      f('capacity', 'Capacity', 'text', { example: '2,000 kg of tea a month' }),
      f('geography', 'Geography', 'list', { example: 'Kathmandu Valley, Pokhara, Ilam' }),
      f('delivery_method', 'Delivery method', 'text', { example: 'Courier across Nepal, own riders inside Kathmandu' }),
    ],
  },
  {
    key: 'products', label: 'Products and services', subject: 'product',
    fields: [
      f('sku', 'SKU or service ID', 'text', { example: 'ILG-250' }),
      f('name', 'Name', 'text', { example: 'Ilam Green Tea 250 g' }),
      f('category', 'Category', 'text', { example: 'Loose-leaf tea' }),
      f('description', 'Description', 'longtext', { example: 'Hand-rolled green tea from Ilam, packed in a 250 g resealable tin.' }),
      f('features', 'Features', 'text', { ...many, example: 'Hand-rolled leaf' }),
      f('benefits', 'Benefits', 'text', { ...many, example: 'Smooth, light taste with no bitterness' }),
      f('eligibility', 'Eligibility', 'text', { example: 'Available to customers in Nepal' }),
      f('exclusions', 'Exclusions', 'text', { example: 'Not sold outside Nepal' }),
      f('price', 'Price', 'money', { asksExpiry: true, example: 'NPR 1,200' }),
      f('billing_unit', 'Billing unit', 'text', { example: 'Per tin' }),
      f('variants', 'Variants', 'list', { example: '100 g, 250 g, 500 g' }),
      f('availability', 'Availability', 'text', { example: 'In stock, ships in 1 to 2 days' }),
      f('warranty', 'Warranty', 'text', { example: 'Replacement if the tin arrives damaged' }),
      f('delivery', 'Delivery', 'text', { example: '2 days in Kathmandu, 4 days elsewhere' }),
      f('support', 'Support', 'text', { example: 'WhatsApp 9am to 6pm, Sunday to Friday' }),
      f('url', 'URL', 'url', { example: 'https://ilamleaf.com.np/shop/ilam-green-tea-250g' }),
      f('approved_assets', 'Approved assets', 'list', { example: 'https://ilamleaf.com.np/media/green-tea-250g.jpg' }),
      f('claims', 'Claims', 'text', { ...many, example: 'Picked and rolled by hand in Ilam' }),
    ],
  },
  {
    key: 'audience', label: 'Audience', subject: 'segment',
    fields: [
      f('geography', 'Geography', 'text', { example: 'Kathmandu Valley' }),
      f('language', 'Language', 'text', { example: 'Nepali' }),
      f('problem', 'Problem', 'longtext', { example: 'Tea lovers in Kathmandu cannot find fresh, honest loose-leaf tea.' }),
      f('desired_outcome', 'Desired outcome', 'longtext', { example: 'A good cup of tea at home, delivered fresh.' }),
      f('trigger', 'Trigger', 'text', { example: 'A gift for Dashain or Tihar' }),
      f('objections', 'Objections', 'text', { ...many, example: 'It costs more than supermarket tea' }),
      f('alternatives', 'Alternatives', 'list', { example: 'Supermarket tea bags, Darjeeling tea' }),
      f('decision_maker', 'Decision maker', 'text', { example: 'The buyer, usually aged 28 to 50' }),
      f('budget_sensitivity', 'Budget sensitivity', 'enum', { options: ['low', 'medium', 'high'] }),
      f('funnel_stage', 'Funnel stage', 'enum', { options: ['awareness', 'consideration', 'decision', 'retention'] }),
      f('evidence', 'Evidence or sample', 'longtext', { example: 'A survey of 40 customers who bought twice.' }),
      f('last_validated', 'Last validated', 'date'),
    ],
  },
  {
    key: 'positioning', label: 'Positioning', subject: 'brand',
    fields: [
      f('category', 'Category', 'text', { example: 'Hand-rolled green tea' }),
      f('purpose', 'Purpose', 'longtext', { example: 'To bring Ilam tea farmers fair prices and tea lovers a fresher cup.' }),
      f('mission', 'Mission', 'longtext', { example: 'Sell honest tea straight from Ilam to every Nepali home.' }),
      f('vision', 'Vision', 'longtext', { example: 'Ilam tea on every table in Nepal.' }),
      f('promise', 'Promise', 'longtext', { example: 'Fresh tea from Ilam, rolled by hand, delivered to your door.' }),
      f('positioning', 'Positioning', 'longtext', { example: 'For tea lovers in Nepal, Ilam Leaf Co. is the hand-rolled tea that comes straight from the farm.' }),
      f('value_proposition', 'Value proposition', 'longtext', { example: 'Fresher tea at a fair price, with the farm named on every tin.' }),
      f('differentiators', 'Differentiators', 'text', { ...many, example: 'No middlemen between the farm and you' }),
      f('proof', 'Proof', 'text', { ...many, example: 'Selling tea since 2009' }),
      f('narrative', 'Narrative', 'longtext', { example: 'Ilam Leaf Co. began in 2009 with one family farm and now ships across Nepal.' }),
      f('prohibited_claims', 'Prohibited claims', 'list', { example: 'Cures illness, the best tea in the world' }),
    ],
  },
  {
    key: 'voice', label: 'Voice', subject: 'brand',
    fields: [
      f('traits', 'Traits', 'list', { example: 'Warm, plain, proud of the farm' }),
      f('channel_tone', 'Channel tone', 'longtext', { example: 'Friendly and short on Facebook, a little more detail on the website.' }),
      f('sentence_length', 'Sentence length', 'text', { example: 'Short, under 20 words' }),
      f('vocabulary', 'Vocabulary', 'list', { example: 'tea garden, hand-rolled, fresh leaf' }),
      f('prohibited_words', 'Prohibited words', 'list', { example: 'cheap, miracle, detox' }),
      f('spelling', 'Spelling', 'text', { example: 'British English, Nepali names spelled as the family spells them' }),
      f('emoji', 'Emoji', 'enum', { options: ['none', 'sparing', 'frequent'] }),
      f('humour', 'Humour', 'enum', { options: ['none', 'light', 'playful'] }),
      f('person', 'Person', 'enum', { options: ['first_singular', 'first_plural', 'second', 'third'] }),
      f('cta', 'Call to action', 'text', { example: 'Order your tin today' }),
      f('on_brand_examples', 'On-brand examples', 'longtext', { ...many, example: 'Rolled by hand in Ilam this week, and on your table by Friday.' }),
      f('off_brand_examples', 'Off-brand examples', 'longtext', { ...many, example: 'BUY NOW!!! Best tea ever, limited miracle offer!' }),
    ],
  },
  {
    // Logo variants are assets and colours are the palette; both have their own tables.
    key: 'visual', label: 'Visual identity', subject: 'brand',
    fields: [
      f('fonts', 'Licensed fonts', 'text', { ...many, example: 'Mukta' }),
      f('photo_style', 'Photo style', 'longtext', { example: 'Natural daylight, tea gardens and hands at work, no stock studio shots.' }),
      f('illustration_style', 'Illustration style', 'longtext', { example: 'Simple line drawings of tea leaves in two colours.' }),
      f('icon_style', 'Icon style', 'longtext', { example: 'Thin outline icons with rounded ends.' }),
      f('grid', 'Grid', 'text', { example: '12 columns with 24 px gutters' }),
      f('spacing', 'Spacing', 'text', { example: '8 px base unit' }),
      f('templates', 'Templates', 'list', { example: 'Product post, festival offer, farm story' }),
      f('aspect_ratios', 'Aspect ratios', 'list', { example: '1:1, 4:5, 9:16' }),
      f('motion_rules', 'Motion rules', 'longtext', { example: 'Slow fades only, never faster than half a second.' }),
      f('mascot_rules', 'Mascot rules', 'longtext', { example: 'No mascot, the farm and its people appear instead.' }),
      f('contrast', 'Contrast', 'text', { example: 'Dark green text on cream, at least 4.5:1' }),
    ],
  },
  {
    key: 'legal', label: 'Legal and trust', subject: 'brand',
    fields: [
      f('registration', 'Registration facts', 'text', { ...many, example: 'Registered company, number 123456/078/079' }),
      f('licences', 'Licences', 'text', { ...many, asksExpiry: true, example: 'Food Technology and Quality Control licence' }),
      f('certifications', 'Certifications', 'text', { ...many, asksExpiry: true, example: 'Organic certificate from a recognised certifier' }),
      f('disclaimers', 'Disclaimers', 'longtext', { ...many, example: 'Tea is not a medicine and does not treat any illness.' }),
      f('privacy_url', 'Privacy policy', 'url', { example: 'https://ilamleaf.com.np/privacy' }),
      f('terms_url', 'Terms', 'url', { example: 'https://ilamleaf.com.np/terms' }),
      f('refund', 'Refund terms', 'longtext', { example: 'Refund or replacement within 7 days if the tin is damaged.' }),
      f('warranty', 'Warranty', 'longtext', { example: 'We replace any tin that arrives damaged or leaks.' }),
      f('claim_evidence', 'Claim evidence', 'longtext', { ...many, example: 'Organic certificate on file, issued for the 2025 harvest.' }),
      f('approval_owner', 'Approval owner', 'text', { example: 'Sunita Rai' }),
    ],
  },
  {
    key: 'goals', label: 'Goals and economics', subject: 'brand',
    fields: [
      f('primary_objective', 'Primary objective', 'text', { example: 'Grow online orders' }),
      f('secondary_objective', 'Secondary objective', 'text', { example: 'Build a list of repeat customers' }),
      f('baseline', 'Baseline', 'text', { example: '120 online orders a month' }),
      f('target', 'Target', 'text', { example: '200 online orders a month' }),
      f('period', 'Period', 'text', { example: 'Next 3 months' }),
      f('kpis', 'KPIs', 'list', { example: 'Orders, cost per lead, repeat rate' }),
      f('monthly_budget', 'Monthly budget', 'money', { example: 'NPR 60,000' }),
      f('channel_budgets', 'Channel budgets', 'longtext', { example: 'Facebook NPR 30,000, Instagram NPR 20,000, Google NPR 10,000.' }),
      f('asset_budgets', 'Asset budgets', 'longtext', { example: 'Photos NPR 10,000, videos NPR 15,000 a month.' }),
      f('max_ai_spend', 'Maximum AI spend', 'money', { example: 'NPR 5,000' }),
      f('cost_per_video_target', 'Cost per video target', 'money', { example: 'NPR 800' }),
      f('cpl_target', 'Cost per lead target', 'money', { example: 'NPR 150' }),
      f('margin_floor', 'Margin floor', 'text', { example: '30%' }),
      f('approval_thresholds', 'Approval thresholds', 'text', { example: 'Any spend over NPR 10,000 needs the owner' }),
      f('approvers', 'Approvers', 'list', { example: 'Sunita Rai, Bikash Rai' }),
    ],
  },
];

export function sectionDef(section: string): SectionDef | undefined {
  return CATALOGUE.find((s) => s.key === section);
}

export function fieldDef(section: string, field: string): FieldDef | undefined {
  return sectionDef(section)?.fields.find((x) => x.key === field);
}
