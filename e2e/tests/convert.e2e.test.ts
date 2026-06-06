import { test, expect } from "@playwright/test";

const RUN = process.env.RUN_E2E === "1";

const MIN_DOCX_BASE64 =
  "UEsDBBQAAAAIAFJPxlzJTxqw6wAAAK4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QvU7DMBDeeQrLK4odGBBCSTrwMwJDeYCTfUks7LPlc0v79jht6YAK4933q69b7YIXW8zsIvXyRrVSIJloHU29/Fi/NPdScAGy4CNhL/fIcjVcdet9QhZVTNzLuZT0oDWbGQOwigmpImPMAUo986QTmE+YUN+27Z02kQpSacriIYfuCUfY+CKed/V9LJLRsxSPR+KS1UtIyTsDpeJ6S/ZXSnNKUFV54PDsEl9XgtQXExbk74CT7q0uk51F8Q65vEKoLP0Vs9U2mk2oSvW/zYWecRydwbN+cUs5GmSukwevzkgARz/99WHu4RtQSwMEFAAAAAgAUk/GXLmBRHGwAAAAKgEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4J1TRN5pWgaEUJMuCKkrKgeIEjeNaB5KwqO3JwMDIAZG278/y233sDO5YUzGOwZNVQNBJ70yTjM4D8f1DkjKwikxe4cMFkzQ8VV7wlnkspMmExIpiEsMppzDntIkJ7QiVT6gK5PRRytyKaOmQciL0Eg3db2l8d0A/mGSXjGIvWqADEvAf2w/jkbiwcurRZd/nPhKFFlEjZnB3UdF1atdFRYob+nHi/wJUEsDBBQAAAAIAFJPxlyXr94JwgAAAOwAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjkFOwzAQRfecwvK+dZoFqqI42fUE7QFMPG0i4hnLYwjdU6kHaCTESbgT4Q7YZcHmfY1m9P7U7ZsbxSsEHgi13KwLKQA7sgOetDzsd6utFBwNWjMSgpZnYNk2D/VUWepeHGAUyYBcTVr2MfpKKe56cIbX5AHT7kjBmZjGcFITBesDdcCcCtyoyqJ4VM4MKJukfCJ7zukzQkZs+slH8vYooATBjp5BLPP1+zL/zB/L+9fyeatVvssMd/o7/1zq/8/mF1BLAQIUAxQAAAAIAFJPxlzJTxqw6wAAAK4BAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgAUk/GXLmBRHGwAAAAKgEAAAsAAAAAAAAAAAAAAIABHAEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgAUk/GXJev3gnCAAAA7AAAABEAAAAAAAAAAAAAAIAB9QEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAOYCAAAAAA==";

test.describe("convert flow", () => {
  test.skip(!RUN, "set RUN_E2E=1 with the docker-compose stack up to run");

  test("dev-auth upload -> running job -> success -> PDF download", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "hwptopdf" })).toBeVisible();
    await page.getByRole("link", { name: "서비스 사용하기" }).click();
    await expect(page.getByText("operator@hwptopdf.local")).toBeVisible();

    await page.setInputFiles('[data-testid="file-input"]', {
      name: "min.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(MIN_DOCX_BASE64, "base64"),
    });

    await expect(page.getByText("작업 큐에서 변환 중입니다.")).toBeVisible();
    await page.getByRole("link", { name: "상세 보기" }).click();
    await expect(page.getByRole("link", { name: "PDF 다운로드" })).toBeVisible({ timeout: 30_000 });

    const download = await page.request.get(
      await page.getByRole("link", { name: "PDF 다운로드" }).evaluate((node) =>
        node.getAttribute("href"),
      ),
    );
    expect(download.status()).toBe(200);
    expect((await download.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
