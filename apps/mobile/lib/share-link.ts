export function shareCodeFromScheme(value: string): string {
  const match = /^daoxueacademy:\/\/share\?code=((?:ARTICLE|COURSE|TEACHER|PRODUCT|EVENT|LIVE|THREAD)_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(value);
  return match ? match[1] : '';
}
