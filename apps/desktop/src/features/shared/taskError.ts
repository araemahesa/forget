export function taskError(message: string): string {
  return message.includes('[REQUEST_TIMEOUT]')
    ? 'Respons provider belum selesai. Coba lagi atau pilih model lain. Hasil sebelumnya tetap aman.'
    : message;
}
