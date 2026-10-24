/** QUIRK(gbis): a data.go.kr gateway refusal as its envelope's returnReasonCode and the message naming the cause. */
export interface GatewayRefusal {
  code: string;
  message: string;
}
