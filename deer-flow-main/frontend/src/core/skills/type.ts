export interface Skill {
  name: string;
  description: string;
  category: string;
  license: string | null;
  enabled: boolean;
  system_enabled?: boolean;
  is_editable?: boolean;
}
