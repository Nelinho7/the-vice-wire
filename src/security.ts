export function safeError(error:unknown):string {
  let text=error instanceof Error?error.message:String(error);
  for(const name of ['TYPESAFE_API_KEY','JEV_API_KEY','OPENAI_API_KEY','LLM_API_KEY','REDDIT_ACCESS_TOKEN','YOUTUBE_API_KEY','YOUTUBE_ACCESS_TOKEN','TWITCH_CLIENT_SECRET','TWITCH_ACCESS_TOKEN','TWITCH_USER_ACCESS_TOKEN','TWITCH_REFRESH_TOKEN']) {
    const secret=process.env[name];if(secret)text=text.split(secret).join('[redacted]');
  }
  return text.replace(/Bearer\s+[^\s,]+/gi,'Bearer [redacted]').replace(/([?&]key=)[^&\s]+/gi,'$1[redacted]').slice(0,500);
}
export function redactSecrets<T>(value:T):T {
  if(value===undefined)return value;
  let text=JSON.stringify(value);
  for(const name of ['TYPESAFE_API_KEY','JEV_API_KEY','OPENAI_API_KEY','LLM_API_KEY','REDDIT_ACCESS_TOKEN','YOUTUBE_API_KEY','YOUTUBE_ACCESS_TOKEN','TWITCH_CLIENT_SECRET','TWITCH_ACCESS_TOKEN','TWITCH_USER_ACCESS_TOKEN','TWITCH_REFRESH_TOKEN']) {
    const secret=process.env[name];if(secret)text=text.split(JSON.stringify(secret).slice(1,-1)).join('[redacted]');
  }
  return JSON.parse(text);
}
