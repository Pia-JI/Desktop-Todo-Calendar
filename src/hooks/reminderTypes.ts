/** 与 Rust scheduler.ReminderPayload 对应的载荷类型 */
export interface ReminderPayload {
  id: string;
  title: string;
  startAt: string;
  priority: number;
  color: string;
  kind: string;
  sentCount: number;
  remindedAt: string;
  body: string;
}
