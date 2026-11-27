'use client';

/* Watermelon UI budget-card (registry.watermelon.sh/r/budget-card.json), adapted: amounts in
   Nepali rupees, no month dropdown and no details modal (it sits in a feature card as a picture). */

import React from 'react';
import { motion } from 'motion/react';

interface BreakdownItem {
  label: string;
  amount: number;
  color: string;
}

interface BudgetCardProps {
  label: string;
  totalBudget: number;
  spentAmount: number;
  breakdown: BreakdownItem[];
}

const npr = (n: number) => `NPR ${n.toLocaleString('en-IN')}`;

export const BudgetCard: React.FC<BudgetCardProps> = ({ label, totalBudget, spentAmount, breakdown }) => {
  const spentPercentage = Math.round((spentAmount / totalBudget) * 100);
  const remainingAmount = totalBudget - spentAmount;
  const smoothTransition = { duration: 1.5, ease: [0.19, 1, 0.22, 1] } as const;
  const cornerClass = 'absolute w-5 h-5 border-black/20';

  return (
    <div className="relative w-full">
      <div className={`${cornerClass} top-0 left-0 z-40 border-t-[1.6px] border-l-[1.6px]`} />
      <div className={`${cornerClass} top-0 right-0 z-40 border-t-[1.6px] border-r-[1.6px]`} />
      <div className="relative w-full border-[1.6px] border-black/8 bg-white font-sans text-black shadow-sm">
        <div className="p-6 pb-4">
          <div className="mb-1 flex items-start justify-between">
            <p className="text-[15px] text-zinc-600">{label}</p>
            <span className="border-[1.6px] border-zinc-200 px-3 py-1 text-[13px] text-zinc-600">Cap on</span>
          </div>
          <p className="mb-6 text-[40px] leading-none font-medium tracking-tight text-zinc-900 tabular-nums">
            {npr(totalBudget)}
          </p>
          <div className="space-y-3">
            <p className="text-[13px] text-zinc-600">Paid generation stops at the cap</p>
            <div className="h-2 w-full overflow-hidden bg-zinc-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${spentPercentage}%` }}
                transition={smoothTransition}
                className="h-full bg-linear-to-r from-[#5f93cc] to-[#0f5257]"
              />
            </div>
            <div className="flex items-end justify-between pt-1">
              <div className="space-y-1.5">
                <span className="block text-[13px] text-zinc-600">Spent</span>
                <div className="flex items-center gap-3">
                  <span className="text-[17px] text-zinc-800 tabular-nums">{npr(spentAmount)}</span>
                  <span className="border border-black/5 bg-gray-100 px-1.5 py-[1.75px] text-[12px] text-zinc-600">
                    {spentPercentage}%
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 text-right">
                <span className="block text-[13px] text-zinc-600">Left</span>
                <span className="text-[17px] text-zinc-800 tabular-nums">{npr(remainingAmount)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="h-px w-full bg-black/5" />
        <div className="space-y-3 p-6 pt-5">
          <p className="text-[13px] text-zinc-600">By kind of work</p>
          <div className="flex h-2 gap-2">
            {breakdown.map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ ...smoothTransition, delay: 0.5 + idx * 0.1 }}
                className="h-full origin-left"
                style={{ flex: item.amount, background: item.color }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {breakdown.map((item) => (
              <div className="flex flex-col gap-1" key={item.label}>
                <p className="truncate text-[13px] text-zinc-600">{item.label}</p>
                <p className="text-[15px] text-zinc-800 tabular-nums">{npr(item.amount)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
