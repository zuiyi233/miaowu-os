'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Star, TrendingUp } from 'lucide-react';

interface MarketingBannerProps {
  title?: string;
  subtitle?: string;
  features?: string[];
  ctaLabel?: string;
  onCtaClick?: () => void;
  variant?: 'default' | 'premium' | 'new';
}

export const MarketingBanner: React.FC<MarketingBannerProps> = ({
  title = 'AI 智能创作助手',
  subtitle = '让 AI 为你的小说创作提供灵感和建议',
  features = ['智能续写', '角色生成', '情节优化', '文风匹配'],
  ctaLabel = '立即体验',
  onCtaClick,
  variant = 'default',
}) => {
  const gradients = {
    default: 'from-primary/10 via-primary/5 to-transparent',
    premium: 'from-amber-500/10 via-amber-500/5 to-transparent',
    new: 'from-blue-500/10 via-blue-500/5 to-transparent',
  };

  const icons = {
    default: <Sparkles className="h-6 w-6" />,
    premium: <Star className="h-6 w-6" />,
    new: <TrendingUp className="h-6 w-6" />,
  };

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className={`bg-gradient-to-r ${gradients[variant]} p-6`}>
        <CardHeader className="p-0 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10 text-primary">
              {icons[variant]}
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {variant !== 'default' && (
              <Badge variant={variant === 'premium' ? 'default' : 'secondary'} className="ml-auto">
                {variant === 'premium' ? 'PRO' : 'NEW'}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex flex-wrap gap-2 mb-4">
            {features.map((feature, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {feature}
              </Badge>
            ))}
          </div>

          {ctaLabel && onCtaClick && (
            <Button onClick={onCtaClick} className="w-full sm:w-auto">
              {ctaLabel}
            </Button>
          )}
        </CardContent>
      </div>
    </Card>
  );
};
