/**
 * Database types for supabase/migrations/*.sql.
 *
 * Shape matches `supabase gen types typescript --linked`, so this file can be
 * regenerated in place with `npx supabase gen types typescript --linked >
 * src/lib/database.types.ts` once the project is linked. Keep it in sync with
 * every new migration.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string;
          description: string;
          name: string;
          slug: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          description: string;
          name: string;
          slug: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          description?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      digest_deliveries: {
        Row: {
          provider_message_id: string | null;
          run_id: string;
          sent_at: string;
          subscriber_id: string;
        };
        Insert: {
          provider_message_id?: string | null;
          run_id: string;
          sent_at?: string;
          subscriber_id: string;
        };
        Update: {
          provider_message_id?: string | null;
          run_id?: string;
          sent_at?: string;
          subscriber_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "digest_deliveries_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "digest_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "digest_deliveries_subscriber_id_fkey";
            columns: ["subscriber_id"];
            isOneToOne: false;
            referencedRelation: "subscribers";
            referencedColumns: ["id"];
          },
        ];
      };
      digest_runs: {
        Row: {
          completed_at: string | null;
          id: string;
          job_count: number;
          period_start: string;
          sent_count: number;
          started_at: string;
          status: string;
        };
        Insert: {
          completed_at?: string | null;
          id?: string;
          job_count?: number;
          period_start: string;
          sent_count?: number;
          started_at?: string;
          status?: string;
        };
        Update: {
          completed_at?: string | null;
          id?: string;
          job_count?: number;
          period_start?: string;
          sent_count?: number;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      employers: {
        Row: {
          company_name: string;
          created_at: string;
          email: string;
          id: string;
          logo_url: string | null;
          stripe_customer_id: string | null;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          company_name: string;
          created_at?: string;
          email: string;
          id?: string;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          company_name?: string;
          created_at?: string;
          email?: string;
          id?: string;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          apply_url: string;
          category_slug: string;
          company: string;
          company_logo_url: string | null;
          company_url: string | null;
          created_at: string;
          description: string;
          employer_id: string | null;
          expires_at: string | null;
          external_id: string | null;
          featured_until: string | null;
          id: string;
          is_featured: boolean;
          job_type: Database["public"]["Enums"]["job_type"];
          location: string;
          published_at: string | null;
          salary_currency: string;
          salary_max: number | null;
          salary_min: number | null;
          search_vector: unknown;
          slug: string;
          source: Database["public"]["Enums"]["job_source"];
          source_name: string | null;
          status: Database["public"]["Enums"]["job_status"];
          stripe_checkout_session_id: string | null;
          tags: string[];
          title: string;
          updated_at: string;
          workplace_type: Database["public"]["Enums"]["workplace_type"];
        };
        Insert: {
          apply_url: string;
          category_slug: string;
          company: string;
          company_logo_url?: string | null;
          company_url?: string | null;
          created_at?: string;
          description: string;
          employer_id?: string | null;
          expires_at?: string | null;
          external_id?: string | null;
          featured_until?: string | null;
          id?: string;
          is_featured?: boolean;
          job_type?: Database["public"]["Enums"]["job_type"];
          location: string;
          published_at?: string | null;
          salary_currency?: string;
          salary_max?: number | null;
          salary_min?: number | null;
          search_vector?: never;
          slug?: string;
          source?: Database["public"]["Enums"]["job_source"];
          source_name?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          stripe_checkout_session_id?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          workplace_type: Database["public"]["Enums"]["workplace_type"];
        };
        Update: {
          apply_url?: string;
          category_slug?: string;
          company?: string;
          company_logo_url?: string | null;
          company_url?: string | null;
          created_at?: string;
          description?: string;
          employer_id?: string | null;
          expires_at?: string | null;
          external_id?: string | null;
          featured_until?: string | null;
          id?: string;
          is_featured?: boolean;
          job_type?: Database["public"]["Enums"]["job_type"];
          location?: string;
          published_at?: string | null;
          salary_currency?: string;
          salary_max?: number | null;
          salary_min?: number | null;
          search_vector?: never;
          slug?: string;
          source?: Database["public"]["Enums"]["job_source"];
          source_name?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          stripe_checkout_session_id?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          workplace_type?: Database["public"]["Enums"]["workplace_type"];
        };
        Relationships: [
          {
            foreignKeyName: "jobs_category_slug_fkey";
            columns: ["category_slug"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "jobs_employer_id_fkey";
            columns: ["employer_id"];
            isOneToOne: false;
            referencedRelation: "employers";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          hits: number;
          key: string;
          window_start: string;
        };
        Insert: {
          hits?: number;
          key: string;
          window_start: string;
        };
        Update: {
          hits?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      subscribers: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          source: string;
          unsubscribe_token: string;
          unsubscribed_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          source?: string;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          source?: string;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_paid_job: {
        Args: {
          p_duration_days?: number;
          p_featured: boolean;
          p_stripe_session_id: string;
        };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      attach_checkout_session: {
        Args: { p_job_id: string; p_session_id: string };
        Returns: undefined;
      };
      begin_digest_run: {
        Args: { p_period_start: string };
        Returns: Database["public"]["Tables"]["digest_runs"]["Row"];
      };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      create_job_posting: {
        Args: { p_employer: Json; p_job: Json };
        Returns: string;
      };
      admin_create_job: {
        Args: { p_days?: number; p_featured?: boolean; p_job: Json };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      admin_stats: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      admin_update_job: {
        Args: { p_action: string; p_days?: number; p_job_id: string };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      are_valid_tags: {
        Args: { p_tags: string[] };
        Returns: boolean;
      };
      finish_digest_run: {
        Args: { p_job_count: number; p_run_id: string; p_status: string };
        Returns: undefined;
      };
      expire_jobs: {
        Args: Record<PropertyKey, never>;
        Returns: {
          expired_count: number;
          unfeatured_count: number;
        }[];
      };
      is_valid_email: {
        Args: { p_email: string };
        Returns: boolean;
      };
      is_valid_slug: {
        Args: { p_slug: string };
        Returns: boolean;
      };
      mark_checkout_expired: {
        Args: { p_session_id: string };
        Returns: number;
      };
      next_digest_recipients: {
        Args: { p_limit?: number; p_run_id: string };
        Returns: {
          email: string;
          subscriber_id: string;
          unsubscribe_token: string;
        }[];
      };
      record_digest_deliveries: {
        Args: { p_deliveries: Json; p_run_id: string };
        Returns: number;
      };
      run_maintenance: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      search_jobs: {
        Args: {
          p_category?: string;
          p_limit?: number;
          p_offset?: number;
          p_query?: string;
          p_tag?: string;
          p_workplace?: Database["public"]["Enums"]["workplace_type"];
        };
        Returns: {
          category_slug: string;
          company: string;
          company_logo_url: string | null;
          id: string;
          is_featured: boolean;
          job_type: Database["public"]["Enums"]["job_type"];
          location: string;
          published_at: string;
          salary_currency: string;
          salary_max: number | null;
          salary_min: number | null;
          slug: string;
          tags: string[];
          title: string;
          total_count: number;
          workplace_type: Database["public"]["Enums"]["workplace_type"];
        }[];
      };
      slugify: {
        Args: { p_input: string };
        Returns: string;
      };
      subscribe_to_digest: {
        Args: { p_email: string; p_source?: string };
        Returns: undefined;
      };
      tags_to_text: {
        Args: { p_tags: string[] };
        Returns: string;
      };
      unsubscribe_from_digest: {
        Args: { p_token: string };
        Returns: boolean;
      };
      upsert_ingested_jobs: {
        Args: { p_close_missing?: boolean; p_jobs: Json; p_source_name: string };
        Returns: Json;
      };
    };
    Enums: {
      job_source: "employer" | "ingested" | "admin";
      job_status: "draft" | "pending_payment" | "payment_expired" | "active" | "expired" | "rejected";
      job_type: "full_time" | "part_time" | "contract" | "internship";
      workplace_type: "remote" | "hybrid" | "onsite";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
export type FunctionReturns<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]["Returns"];

export const Constants = {
  public: {
    Enums: {
      job_source: ["employer", "ingested", "admin"],
      job_status: ["draft", "pending_payment", "payment_expired", "active", "expired", "rejected"],
      job_type: ["full_time", "part_time", "contract", "internship"],
      workplace_type: ["remote", "hybrid", "onsite"],
    },
  },
} as const;
