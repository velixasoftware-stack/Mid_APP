import api from '../api/client';

export async function downloadFile(url, filename) {
  const { data } = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}
