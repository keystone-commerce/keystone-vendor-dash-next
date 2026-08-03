export interface DriveFile {
  id: string;
  name: string;
  kind: "catalogue" | "bill";
  webViewLink: string | null;
  modifiedTime: string;
}

export interface DriveUploadInput {
  vendorName: string;
  kind: "catalogue" | "bill";
  uploadedAt: Date;
  originalFilename: string;
  mimeType: string;
  data: Buffer;
}

export interface DriveUploadResult {
  fileId: string;
  name: string;
  webViewLink: string | null;
}

export interface DriveClient {
  /** List catalogue files in the configured Catalogues folder. */
  listCatalogues(): Promise<DriveFile[]>;
  /** Upload a file on behalf of a user (used by the manual attach flow). */
  upload(input: DriveUploadInput): Promise<DriveUploadResult>;
}
