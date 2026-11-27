import type { CSSProperties } from 'react';
import HeroAurora from '@/components/hero-aurora';
import BriefFanout from '@/components/brief-fanout';
import AIToolApproval from '@/components/kokonutui/ai-tool-approval';
import { BudgetCard } from '@/components/watermelon/budget-card';

/* type: software
   deal: hero centred, nav nav-centre (nav-cards re-dealt: no photographs), close close-word,
         footer footer-statement, rhythm space (the moment's section is the one dark ground),
         buttons arrow, mark ring, ground sage, palette swap-pastels, pairing geist, radius soft
   effect: React Bits Aurora in the hero frame
   moments: line-carries-colour on #channels */

const v = (o: Record<string, string | number>) => o as CSSProperties;


const CHANNELS = {
  layout: 'hub',
  alt: 'Prachaar posts to Facebook, Instagram, TikTok, YouTube, LinkedIn, Pinterest, WhatsApp and email.',
  center: { label: 'Prachaar' },
  spokes: [
    { label: 'Facebook', icon: 'facebook' },
    { label: 'Instagram', icon: 'instagram' },
    { label: 'TikTok', icon: 'tiktok' },
    { label: 'YouTube', icon: 'youtube' },
    { label: 'LinkedIn', icon: 'linkedin' },
    { label: 'Pinterest', icon: 'pinterest' },
    { label: 'WhatsApp', icon: 'whatsapp' },
    { label: 'Email', icon: 'ui:mail' },
  ],
};

const RING = 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z';

const QUEUE = [
  ['CW', 1, 'Copywriter', 'Dashain offer, three posts', 'Needs you', 'is-you', '10:00'],
  ['DS', 3, 'Designer', 'Carousel, five slides', 'Queued', '', '11:30'],
  ['VP', 4, 'Video producer', 'Reel script, 30 seconds', 'Queued', '', '13:00'],
  ['CM', 2, 'Community', '12 comments to answer', 'Queued', '', '13:30'],
  ['SE', 5, 'SEO', 'Titles for 8 product pages', 'Queued', '', '15:00'],
  ['EM', 1, 'Email', 'December newsletter', 'Queued', '', '16:00'],
  ['BR', 3, 'Brand', 'Two facts expire this week', 'Needs you', 'is-you', '17:00'],
  ['CI', 4, 'Competitors', 'Two price changes found', 'Approved', 'is-done', '08:10'],
  ['AN', 2, 'Analyst', 'Weekly report', 'Approved', 'is-done', '08:30'],
  ['WA', 5, 'WhatsApp', 'Order follow-up template', 'Approved', 'is-done', '07:50'],
] as const;

const FAQ = [
  ['Does the software post on its own?', 'No. Posts, replies and messages wait for your approval, and an edited draft has to be approved again.'],
  ['Will it launch ads or change my marketing budget?', 'No. It prepares ad tests and recommends changes; a person on your team launches them and sets the spend.'],
  ['Can it promise more product sales?', 'No. It reports what each post and campaign brought in, so you keep what works and drop what does not.'],
  ['Does it train AI models on my customer data?', 'No, not without your written permission. Your brand’s data is kept apart from every other brand’s.'],
  ['Which AI models does it use, and at what price?', 'Local and open models first. Paid ones run only when a job needs them, with the cost shown before it starts.'],
];

const check = <svg viewBox="0 0 16 16"><path d="m4.5 8.2 2.3 2.3 4.7-5" /></svg>;

export default function Home() {
  return (
    <>
      <header className="nav nav--centre">
        <div className="wrap nav__bar">
          <a className="skip-link" href="#top">Skip to content</a>
          <a className="nav__logo" href="#top"><span className="mark" data-mark="ring" aria-hidden="true" />Prachaar</a>
          <nav className="nav__links" aria-label="Main">
            <div className="nav__item"><a className="nav__link" href="#queue">Queue</a></div>
            <div className="nav__item">
              <a className="nav__link" href="#features">Features <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
              <div className="nav__menu">
                <div className="wrap grid">
                  <div className="menu-col span-3">
                    <p className="t-label">Before it posts</p>
                    <a href="#formats">Formats<span>One brief, seven formats</span></a>
                    <a href="#approval">Approval<span>Nothing public without you</span></a>
                  </div>
                  <div className="menu-col span-3">
                    <p className="t-label">While it runs</p>
                    <a href="#cost">Cost<span>Rupees shown before each job</span></a>
                    <a href="#watch">Competitors<span>Three rivals checked weekly</span></a>
                  </div>
                </div>
              </div>
            </div>
            <div className="nav__item"><a className="nav__link" href="#channels">Channels</a></div>
            <div className="nav__item"><a className="nav__link" href="#questions">Questions</a></div>
          </nav>
          <div className="nav__actions">
            <a className="btn btn--primary" href="#apply">Join the pilot</a>
          </div>
          <button className="nav__toggle" type="button" aria-expanded="false" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero hero--centred" data-enter="" aria-labelledby="hero-h">
          <div className="wrap"><div className="hero-text">
            <div className="hero__c">
              <a className="pill" href="#apply"><span>Pilot</span><span className="muted">Starts with one brand in Nepal</span></a>
              <h1 id="hero-h">AI marketing team for Nepali brands</h1>
              <p className="hero__lead">Prachaar’s 20 AI roles research, write, design and schedule your posts. Each job shows its cost in rupees first, and nothing goes public until you approve it.</p>
              <div className="btn-row">
                <a className="btn btn--primary" href="#apply">Join the pilot</a>
                <a className="btn btn--secondary" href="#queue">See the queue</a>
              </div>
            </div>
            <div className="hero__window" role="img" aria-label="Prachaar’s copywriter role has drafted three Instagram posts for a Dashain offer, removed one unsupported claim and is waiting for approval.">
              <HeroAurora />
              <div className="ly-piece d-win d-win--dark" aria-hidden="true">
                <div className="d-win__bar"><span className="d-win__dots"><i /><i /><i /></span><span><b>Copywriter</b> · Dashain offer</span><span className="sp" /><span>Instagram · Facebook</span></div>
                <div className="d-win__body">
                  <div className="inbox">
                    <div className="q">Search the queue</div>
                    <div className="t is-on"><i style={{ background: '#c3d7e5' }}>CW</i><b>Copywriter</b><time>09:12</time><span>Dashain offer, three posts</span></div>
                    <div className="t"><i style={{ background: '#9fd3b5' }}>CM</i><b>Community</b><time>09:05</time><span>12 comments to answer</span></div>
                    <div className="t"><i style={{ background: '#f3c98b' }}>AN</i><b>Analyst</b><time>08:30</time><span>Weekly report sent</span></div>
                  </div>
                  <div className="convo">
                    <div className="d-chat" data-ly-steps="900">
                      <div className="d-msg d-msg--me">Write three Instagram posts for the Dashain offer.<small>09:12</small></div>
                      <div className="d-tool" data-step="">Reading 14 approved brand facts and last month’s posts</div>
                      <div className="d-msg d-msg--bot" data-step="">Three posts are ready. I left out “lowest price in Kathmandu”: no approved fact backs it.<small>Draft · NPR 6</small></div>
                      <div className="acts" data-step=""><span>Approve</span><span>Edit</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div></div>
        </section>

        <section className="section" id="queue" aria-labelledby="queue-h">
          <div className="wrap">
            <div className="grid">
              <h2 id="queue-h" className="span-5">Today’s marketing work in one ranked queue</h2>
              <div className="span-6 start-7 stack-4"><p>Every morning Prachaar ranks the day’s jobs by what they are worth, with the role, the cost and the time due. Open one to read the draft and its checks.</p><p><a className="link" href="#approval">See how approval works</a></p></div>
            </div>
            <div className="ui app fill" role="img" aria-label="The Prachaar queue: ten jobs by role and status beside an open Instagram draft, where one claim is blocked for having no approved source." data-ui-pause-host="">
              <div className="app__pane app__pane--list">
                <div className="ui ui-panel ui-win" data-ui="window" data-open="Queued" data-work="Drafting" data-done="Ready">
                  <div className="ui-win__bar">
                    <span className="ui-dots" aria-hidden="true"><i /><i /><i /></span>
                    <span className="ui-win__crumb"><svg className="ui-brand" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d={RING} /></svg>Prachaar <i>/</i> <b>Today</b></span>
                    <span className="ui-spacer" />
                    <span className="ui-win__search" aria-hidden="true"><svg className="ui-icon" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg><span className="ui-win__ph">Search</span><span className="ui-kbd">/</span></span>
                  </div>
                  <div className="ui-win__body">
                    <nav className="ui-win__side" aria-hidden="true">
                      <span className="ui-win__nav is-on"><svg className="ui-icon" viewBox="0 0 16 16"><path d="M2.5 9h3l1 1.5h3l1-1.5h3" /><path d="M2.5 9 4 3.5h8L13.5 9v3.5h-11z" /></svg>Today<em>10</em></span>
                      <span className="ui-win__nav"><svg className="ui-icon" viewBox="0 0 16 16"><circle cx="8" cy="6" r="2.5" /><path d="M3.5 13.5c.6-2.3 2.4-3.5 4.5-3.5s3.9 1.2 4.5 3.5" /></svg>Needs you<em>2</em></span>
                      <span className="ui-win__nav"><svg className="ui-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>Scheduled<em>14</em></span>
                      <span className="ui-win__nav"><svg className="ui-icon" viewBox="0 0 16 16"><path d="m3.5 8.4 2.8 2.8 6.2-6.4" /></svg>Published</span>
                      <span className="ui-win__label">Channels</span>
                      <span className="ui-win__nav"><span className="ui-win__hash">#</span>Instagram</span>
                      <span className="ui-win__nav"><span className="ui-win__hash">#</span>Facebook</span>
                    </nav>
                    <div className="ui-win__main">
                      <div className="ui-win__cols" aria-hidden="true"><span>Role</span><span>Job</span><span>Status</span><span>Due</span></div>
                      <ul className="ui-win__rows">
                        {QUEUE.map(([ini, tone, who, sub, st, cls, due]) => (
                          <li className="ui-win__row" data-row="" key={sub}>
                            <span className="ui-avatar" data-tone={tone}>{ini}</span>
                            <span className="ui-win__who">{who}</span>
                            <span className="ui-win__sub">{sub}</span>
                            <span className={`ui-win__st ${cls}`.trim()} data-st="">{st}</span>
                            <span className="ui-win__age">{due}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="app__pane app__pane--open" data-ui-loop="">
                <div className="ui ui-doc" data-ui="doc">
                  <article className="ui-doc__page">
                    <div className="ui-doc__label">Instagram post 1 of 3, draft 2</div>
                    <div className="ui-doc__title">Dashain offer</div>
                    <div className="ui-doc__text">This Dashain, take <mark className="ui-doc__mark is-on">15% off</mark> every pashmina shawl until 24 October.</div>
                    <div className="ui-doc__text">Woven by hand in Bhaktapur, and <mark className="ui-doc__mark" data-kind="Blocked" data-msg="No approved fact backs this claim." data-where="Claims check, before approval">the lowest price in Kathmandu</mark>.</div>
                    <div className="ui-doc__text">Order on WhatsApp or visit the shop in Thamel. Delivery is free inside the Ring Road.</div>
                    <div className="ui-doc__text">Three sizes and eleven colours, with gift wrapping on request.</div>
                    <div className="ui-doc__text">Caption in English and Nepali, with five hashtags from the brand list.</div>
                    <div className="ui-doc__text">Picture: the red shawl on the shop counter, from the approved photo set.</div>
                  </article>
                  <aside className="ui-doc__note ui-panel is-on">
                    <div className="ui-doc__kind"><span className="ui-doc__dot" /><span data-doc-kind="">Approved fact</span></div>
                    <div className="ui-doc__msg" data-doc-msg="">15% off until 24 October, from the offer brief.</div>
                    <div className="ui-doc__where" data-doc-where="">Brand facts, approved 2 October</div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section g2 g2m" id="features" aria-labelledby="features-h">
          <div className="wrap">
            <div className="group">
              <div className="section-head">
                <h2 id="features-h">Formats, approval, prices and competitors</h2>
              </div>
              <div className="grid">
                <article className="card card--row card--open span-6 m-nolift" id="formats">
                  <h3>Turns one marketing brief into 7 formats</h3>
                  <p>An approved brief becomes a landing page, email, posts, a video script and three more.</p>
                  <div className="panel"><BriefFanout /></div>
                </article>
                <article className="card card--row card--open span-6 m-nolift" id="approval">
                  <h3>Holds each marketing post for approval</h3>
                  <p>You approve the exact version that posts.</p>
                  <div className="panel"><div className="stage stage--fade-b"><div className="island ui ui-island tw" style={v({ '--iw': '224px', '--ib': '32px' })}><AIToolApproval /></div></div></div>
                </article>
              </div>
            </div>
            <div className="grid">
              <article className="card card--row card--open span-6 m-nolift" id="cost">
                <h3>Prices every AI job before it runs</h3>
                <p>Each job is priced in rupees before it starts, and a monthly cap stops paid generation.</p>
                <div className="panel"><div className="stage stage--fade-b"><div className="island island--top ui ui-island tw" style={v({ '--iw': '230px' })}>
                  <BudgetCard
                    label="December budget"
                    totalBudget={25000}
                    spentAmount={9240}
                    breakdown={[
                      { label: 'Video', amount: 5600, color: '#0f5257' },
                      { label: 'Images', amount: 2410, color: '#5f93cc' },
                      { label: 'Copy', amount: 1230, color: '#9fb8c8' },
                    ]}
                  />
                </div></div></div>
              </article>
              <article className="card card--row card--open span-6 m-nolift" id="watch">
                <h3>Watches 3 competitors every week</h3>
                <p>Their pricing pages, offers and new ads are compared with last week’s, with screenshots saved.</p>
                <div className="panel">
                  <div className="stage stage--fade-b">
                    <div className="at-rise fit" style={v({ '--fit-max': '380px', '--ax': '32px', '--ay': 'calc(100% - 180px)', '--ay-sm': 'calc(100% - 180px)' })}>
                      <div className="ui ui-notify" data-ui="notify">
                        <ul className="ui-notify__list" data-notify-list="">
                          <li className="ui-note"><span className="ui-agent ui-note__av" aria-hidden="true" /><span className="ui-note__text"><span className="ui-note__title">Price change found<time>now</time></span><span className="ui-note__body">Competitor 1 cut jacket prices by 10%</span></span><span className="ui-btn ui-btn--sm ui-note__btn">Open</span></li>
                          <li className="ui-note"><span className="ui-agent ui-note__av" aria-hidden="true" /><span className="ui-note__text"><span className="ui-note__title">New ad found<time>2h</time></span><span className="ui-note__body">Competitor 3 runs a Dashain giveaway</span></span></li>
                          <li className="ui-note"><span className="ui-note__ico"><svg className="ui-icon" viewBox="0 0 16 16"><path d="m3.5 8.4 2.8 2.8 6.2-6.4" /></svg></span><span className="ui-note__text"><span className="ui-note__title">Test suggested<time>3h</time></span><span className="ui-note__body">Answer the price cut with a bundle</span></span></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section ground-inverse" id="channels" data-moment="line-carries-colour" data-moment-opts='{"from": "base"}' aria-labelledby="channels-h">
          <div className="wrap">
            <div className="grid">
              <div className="span-5 stack-5">
                <h2 id="channels-h">Posts to 8 channels from one calendar</h2>
                <p className="t-lead">Each channel keeps its own sizes, limits and rules. The pilot connects two or three of yours; the rest get a finished draft to post by hand.</p>
                <ul className="facts">
                  <li>Comments and messages are sorted, with replies drafted for you</li>
                  <li>A post that timed out is checked before any retry, so nothing goes out twice</li>
                  <li>Every post is tracked to the leads it brings in</li>
                </ul>
                <p><a className="link" href="#apply">See what the pilot covers</a></p>
              </div>
              <div className="frame frame--split span-6 start-7" data-visual="">
                <div className="dg" data-diagram={JSON.stringify(CHANNELS)} />
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="questions" aria-labelledby="questions-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-5 stack-4">
                <h2 id="questions-h">Questions</h2>
                <p>Approval, ads, results, data and models.</p>
                <p><a className="link" href="mailto:hello@prachaar.example">Email us</a></p>
              </div>
              <div className="faq span-6 start-7">
                {FAQ.map(([q, a]) => (
                  <div className="faq__item" key={q}><h3>{q}</h3><p>{a}</p></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="apply" aria-labelledby="apply-h">
          <div className="wrap">
            <div className="grid">
              <div className="span-6 stack-5">
                <h2 id="apply-h">Pilot for brands in Nepal</h2>
                <p className="t-lead">The pilot starts with one brand: its facts, its first week of posts and a report of what each asset cost.</p>
                <form className="form" action="mailto:pilot@prachaar.example" method="post" encType="text/plain" data-endpoint="" data-sent="Your pilot application is in. We reply by email." noValidate>
                  <div className="field"><label htmlFor="f-name">Name</label>
                    <input id="f-name" name="name" type="text" autoComplete="name" required aria-describedby="f-name-err" />
                    <p className="field__error" id="f-name-err" hidden>Write your name.</p></div>
                  <div className="field"><label htmlFor="f-email">Email</label>
                    <input id="f-email" name="email" type="email" autoComplete="email" inputMode="email" required aria-describedby="f-email-err" />
                    <p className="field__error" id="f-email-err" hidden>Write an email address with an @, like name@example.com.</p></div>
                  <div className="field"><label htmlFor="f-brand">Brand</label>
                    <input id="f-brand" name="brand" type="text" autoComplete="organization" required aria-describedby="f-brand-err" />
                    <p className="field__error" id="f-brand-err" hidden>Write the brand’s name.</p></div>
                  <div className="field"><label htmlFor="f-site">Website or Facebook page</label>
                    <input id="f-site" name="site" type="text" autoComplete="url" required aria-describedby="f-site-err" />
                    <p className="field__error" id="f-site-err" hidden>Write a link people use to find the brand.</p></div>
                  <div className="btn-row"><button className="btn btn--primary" type="submit">Join the pilot</button></div>
                  <p className="form__status" role="status" data-form-status="" />
                  <p className="t-small muted">A person reads every application and replies by email.</p>
                </form>
              </div>
              <div className="frame frame--split span-6 start-7" data-visual="" role="img" aria-label="The pilot’s week one checklist: facts approved, competitors named, then two channels, the monthly cap and the first week’s plan.">
                <div className="stage stage--fade-b">
                  <div className="at-rise fit" style={v({ '--fit-max': '340px', '--ax': 'max(24px, 50% - 170px)', '--ay': '40px' })}>
                    <div className="ui ui-panel ui-checks" data-ui="checklist">
                      <div className="ui-checks__head">
                        <div className="ui-title">Week one</div>
                        <span className="ui-spacer" />
                        <div className="ui-meta" data-checks-count="">2 of 5</div>
                      </div>
                      <div className="ui-checks__bar"><i data-checks-bar="" style={v({ '--k': 0.4 })} /></div>
                      <ul className="ui-checks__list">
                        <li className="ui-check is-done"><span className="ui-check__box">{check}</span><span className="ui-check__label">Approve your product facts</span></li>
                        <li className="ui-check is-done"><span className="ui-check__box">{check}</span><span className="ui-check__label">Name three competitors</span></li>
                        <li className="ui-check"><span className="ui-check__box">{check}</span><span className="ui-check__label">Connect two channels</span></li>
                        <li className="ui-check"><span className="ui-check__box">{check}</span><span className="ui-check__label">Set the monthly cap</span></li>
                        <li className="ui-check"><span className="ui-check__box">{check}</span><span className="ui-check__label">Approve the first week’s plan</span></li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>

      <footer className="footer closing footer--statement" id="contact" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--word">
            <div className="section-head--split">
              <div><h2 id="close-h">One queue for your marketing</h2><p className="t-lead">Start with one brand and one week of posts.</p></div>
              <a className="btn btn--primary" href="#apply">Join the pilot</a>
            </div>
            <p className="close__word" aria-hidden="true">Prachaar</p>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="span-6 stack-4">
                <a className="nav__logo" href="#top"><span className="mark" data-mark="ring" aria-hidden="true" />Prachaar</a>
              </div>
              <div className="span-2 footer__col"><h3>Product</h3><ul><li><a href="#queue">Queue</a></li><li><a href="#features">Features</a></li><li><a href="#channels">Channels</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Pilot</h3><ul><li><a href="#apply">Application</a></li><li><a href="#questions">Questions</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Contact</h3><ul><li><a href="mailto:hello@prachaar.example">Email us</a></li></ul></div>
            </div>
            <div className="footer__legal">
              <span>&copy; 2026 Prachaar</span>
              <span className="credits">Product names and logos are trademarks of their owners</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
