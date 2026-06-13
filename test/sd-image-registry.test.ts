import { resolveImageModels } from "../app/components/sd/image-registry";
import { SupportedEndpoint } from "../app/client/api";
import type { LLMModel } from "../app/client/api";

describe("image model registry", () => {
  test("accepts router image models marked by modelType", () => {
    const models: LLMModel[] = [
      {
        name: "gpt-image-1",
        available: true,
        sorted: 1,
        modelType: "image",
        tags: [],
        supportedEndpoints: [SupportedEndpoint.ImagesGenerations],
        provider: {
          id: "router",
          providerName: "Router",
          providerType: "router",
          sorted: 1,
        },
      },
    ];

    expect(resolveImageModels(models, "generation")).toMatchObject([
      {
        value: "gpt-image-1",
        providerName: "Router",
        endpointType: "images-generation",
      },
    ]);
  });
});
