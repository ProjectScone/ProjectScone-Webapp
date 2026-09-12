const controls=/[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** Presentation only: keep the original value for requests and identity checks. */
export function displayFilename(value:string):string{
 if(!controls.test(value)&&!/[\ud800-\udfff]/u.test(value))return value;
 return JSON.stringify(value).replace(/[\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
}
