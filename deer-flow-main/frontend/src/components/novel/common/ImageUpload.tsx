'use client';

import { Loader2, ImagePlus } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ImageUploadProps {
  value?: string;
  onChange?: (url: string) => void;
  maxSize?: number;
  accept?: string;
  className?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  value,
  onChange,
  maxSize = 5,
  accept = 'image/*',
  className,
}) => {
  const [isUploading, setIsUploading] = React.useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxSize * 1024 * 1024) {
      alert(`文件大小不能超过 ${maxSize}MB`);
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        onChange?.(result);
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          disabled={isUploading}
          className="hidden"
          id="image-upload"
        />
        <label htmlFor="image-upload" className="flex-1">
          <Button
            variant="outline"
            className="w-full cursor-pointer"
            disabled={isUploading}
            type="button"
            asChild
          >
            <span className="flex items-center gap-2">
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {isUploading ? '上传中...' : '选择图片'}
            </span>
          </Button>
        </label>
      </div>

      {value && (
        <div className="mt-2 relative group">
          <img src={value} alt="Uploaded" className="max-h-40 rounded-md object-cover" />
        </div>
      )}
    </div>
  );
};
