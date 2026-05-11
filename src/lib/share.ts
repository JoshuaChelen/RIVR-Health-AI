export type ShareLinkMessage = {
  title: string;
  message: string;
  url: string;
};

export function buildShareLinkMessage(url: string): ShareLinkMessage {
  return {
    title:   "RIVR Health secure link",
    message: `RIVR Health secure link:\n${url}`,
    url,
  };
}
